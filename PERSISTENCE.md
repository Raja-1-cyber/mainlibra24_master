# Data Persistence (IDs / Coins na delete hon)

Render Free disk **redeploy pe wipe** ho jata hai.

## Fix (recommended)
1. Render Dashboard → your service → **Disks**
2. Add Persistent Disk, mount path: `/var/data`
3. Environment variable:
   ```
   DATA_DIR=/var/data
   ```
4. Redeploy

Ab users, coins, agents, history disk pe save rahenge — IDs delete nahi hongi.

## Without disk
Har deploy pe data reset ho sakta hai. Master auto recreate: `master` / `master123`
