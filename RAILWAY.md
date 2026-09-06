# Railway deploy — Libra 24

Public URL example: `https://mainlibra24master-production.up.railway.app`

## Data save (users / coins)

1. Open service **mainlibra24_master**
2. **Variables** → add:
   - `DATA_DIR` = `/data`
3. **Volumes** → **Add Volume**
   - Mount path: `/data`
4. Redeploy

`server.js` uses `DATA_DIR` or auto-detects writable `/data`.

Without a Volume, data can reset on each redeploy.

## Login
- Master: `master` / `master123`

## Trial
- $5 credit / max 30 days
- After trial: Hobby ~$5/mo or limited Free plan
