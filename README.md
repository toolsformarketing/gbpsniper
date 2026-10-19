# GBP Sniper: deploy on Railway via GitHub

The server holds your DataForSEO password, enforces limits, and also serves the tool page.
Visit your Railway URL and the whole tool is there (do not use the claude.ai copy for live search).

## 1. Push to GitHub
1. Create a new **private** GitHub repo.
2. Upload these files (or `git init`, `git add .`, `git commit`, `git push`). Never commit a `.env` file.

## 2. Deploy on Railway
1. Railway: New Project, Deploy from GitHub repo, pick the repo.
2. Open the service, Variables, and add:
   - `DFS_LOGIN` = your DataForSEO login (email)
   - `DFS_PASSWORD` = your DataForSEO **API password** (from the API access page, not your account password)
   - `ACCESS_CODE` = a long random code you share with your team
   - Optional: `DAILY_SPEND_CAP_USD` (default 2), `PER_IP_PER_HOUR` (default 20), `CACHE_HOURS` (default 24)
3. Settings, Networking, **Generate Domain**. Open that URL.
4. Check `/health` returns `{"ok":true}`.

## 3. First test
Enter your access code, a keyword, location `Madurai,Tamil Nadu,India`, click **Search and fill**.
The message shows the cost per search. Check it against your DataForSEO usage page.
If the location is rejected, use the coordinates box instead (e.g. `9.9252,78.1198,17z`). The coordinate format is
from DataForSEO docs as I understand them; verify with one test.

## Safety notes
- In DataForSEO, set a **spend alert or low balance** so a mistake cannot drain your account.
- Spend cap, rate limits and cache are in server memory: they reset when Railway restarts or redeploys.
- Change `ACCESS_CODE` if it leaks. Rotate the DataForSEO API password if you ever paste it anywhere public.
- Saved clients are still stored in each person's browser, not on the server (next upgrade: a database).
