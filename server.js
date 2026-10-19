const express = require('express');
const path = require('path');
const crypto = require('crypto');

const { DFS_LOGIN, DFS_PASSWORD, ACCESS_CODE } = process.env;
const DEVICE = process.env.DEVICE || 'mobile';
const DEPTH = Math.min(parseInt(process.env.DEPTH || '20', 10) || 20, 20); // hard ceiling 20
const DAILY_SPEND_CAP = parseFloat(process.env.DAILY_SPEND_CAP_USD || '2');
const PER_IP_PER_HOUR = parseInt(process.env.PER_IP_PER_HOUR || '20', 10);
const CACHE_MS = (parseFloat(process.env.CACHE_HOURS || '24') || 24) * 3600e3;
const ENDPOINT = 'https://api.dataforseo.com/v3/serp/google/maps/live/advanced';

const app = express();
app.set('trust proxy', 1); // Railway sits behind a proxy
app.use(express.json({ limit: '10kb' }));

// ---- spend cap (resets daily; also resets if the server restarts) ----
const today = () => new Date().toISOString().slice(0, 10);
let day = today(), spent = 0;
const roll = () => { if (today() !== day) { day = today(); spent = 0; } };

// ---- per-IP rate limit (counts every attempt, including wrong codes) ----
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  if (arr.length >= PER_IP_PER_HOUR) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr); return false;
}

// ---- cache (same search within CACHE_HOURS is free) ----
const cache = new Map();
function cacheSet(k, data) {
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  cache.set(k, { t: Date.now(), data });
}

function codeOk(given) {
  if (!ACCESS_CODE || !given) return false;
  const h = s => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(given), h(ACCESS_CODE));
}

app.get('/health', (_req, res) => res.json({ ok: true, configured: { DFS_LOGIN: !!DFS_LOGIN, DFS_PASSWORD: !!DFS_PASSWORD, ACCESS_CODE: !!ACCESS_CODE } }));

app.post('/api/search', async (req, res) => {
  if (!DFS_LOGIN || !DFS_PASSWORD || !ACCESS_CODE)
    return res.status(500).json({ error: 'Server not configured: set DFS_LOGIN, DFS_PASSWORD and ACCESS_CODE.' });
  if (limited(req.ip))
    return res.status(429).json({ error: 'Too many searches from this connection. Try again later.' });
  if (!codeOk(req.get('x-access-code')))
    return res.status(401).json({ error: 'Wrong access code.' });

  const keyword = String(req.body.keyword || '').trim().slice(0, 100);
  const location = String(req.body.location || '').trim().slice(0, 100);
  const coordinate = String(req.body.coordinate || '').trim();
  if (!keyword || (!location && !coordinate))
    return res.status(400).json({ error: 'Enter a keyword and a location (or coordinates).' });
  if (coordinate && !/^-?\d{1,2}(\.\d+)?,-?\d{1,3}(\.\d+)?(,\d{1,2}z)?$/.test(coordinate))
    return res.status(400).json({ error: 'Coordinates must look like 9.9252,78.1198,17z' });

  const key = [keyword, location, coordinate].join('|').toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_MS) return res.json({ ...hit.data, cached: true });

  roll();
  if (spent >= DAILY_SPEND_CAP)
    return res.status(429).json({ error: 'Daily spend cap reached. Try again tomorrow or raise DAILY_SPEND_CAP_USD.' });

  try {
    const task = { keyword, language_code: 'en', device: DEVICE, depth: DEPTH, search_this_area: true, search_places: true };
    if (coordinate) task.location_coordinate = coordinate; else task.location_name = location;

    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([task]),
    });
    const j = await r.json();
    const cost = Number(j.cost) || 0;
    spent += cost;
    const t = j.tasks && j.tasks[0];
    if (!r.ok || !t || t.status_code !== 20000)
      return res.status(502).json({ error: 'Data provider error: ' + ((t && t.status_message) || j.status_message || r.status) });

    const items = ((t.result && t.result[0] && t.result[0].items) || []).filter(i => i.title).map(i => ({
      rank_group: i.rank_group,
      title: i.title,
      place_id: i.place_id,
      category: i.category,
      additional_categories: i.additional_categories,
      category_ids: i.category_ids,
      rating: { value: i.rating && i.rating.value, votes_count: i.rating && i.rating.votes_count },
      total_photos: i.total_photos,
      domain: i.domain,
      phone: i.phone,
      address: i.address,
      latitude: i.latitude,
      longitude: i.longitude,
      is_claimed: i.is_claimed,
    }));
    const data = { keyword, location, coordinate, cost, items };
    cacheSet(key, data);
    console.log(`[search] "${keyword}" @ ${coordinate || location} cost=$${cost} spentToday=$${spent.toFixed(4)}`);
    res.json(data);
  } catch (e) {
    console.error('[search] failed', e.message);
    res.status(502).json({ error: 'Could not reach the data provider.' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log('GBP Sniper listening on ' + port));
