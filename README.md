Libra 24 — Master Platform
Master + Agent + Player dashboard with 4 connected games and Master Game Decision Panel.
Login
Master: `master` / `master123`
Run local
```bash
npm install
node server.js
```
Open: http://localhost:3000
Features
Master / Agent / Player roles
Coin credit/debit + history
4 games: Dragon Tiger, Teen Patti, Andar Bahar, Lucky 7
Game Controller: live side totals + force result (player ko control nahi dikhta)
Live bets feed
Deploy (Render / Railway / VPS)
```bash
npm install
node server.js
```
Set `PORT` env if needed.
Structure
```
server.js
package.json
public/
  master.html      # Master panel (decision + live totals)
  agent.html
  dashboard.html
  login.html
  app.css
  games/
    dragon-tiger/index.html
    teen-patti/index.html
    andar-bahar/index.html
    lucky-7/index.html
data/              # JSON storage (users, games, history)
```
