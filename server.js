const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, 'data');
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA);

const FILES = {
  users: path.join(DATA, 'users.json'),
  games: path.join(DATA, 'games.json'),
  settings: path.join(DATA, 'settings.json'),
  notifs: path.join(DATA, 'notifications.json'),
  transactions: path.join(DATA, 'transactions.json'),
  gameHistory: path.join(DATA, 'game_history.json')
};

function load(file, def = {}) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch(e){}
  return def;
}
function save(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let users = load(FILES.users, {});
let games = load(FILES.games, {
  dragon: { id: 'dragon', name: 'Dragon Tiger', image: '', url: '/games/dragon-tiger/index.html', active: true, order: 1 },
  teenpatti: { id: 'teenpatti', name: 'Teen Patti', image: '', url: '/games/teen-patti/index.html', active: true, order: 2 },
  andarbahar: { id: 'andarbahar', name: 'Andar Bahar', image: '', url: '/games/andar-bahar/index.html', active: true, order: 3 },
  lucky7: { id: 'lucky7', name: 'Lucky 7', image: '', url: '/games/lucky-7/index.html', active: true, order: 4 }
});
let settings = load(FILES.settings, {
  siteName: 'Libra 24',
  notifyAgents: []
});
let notifications = load(FILES.notifs, []);
let transactions = load(FILES.transactions, []);
let gameHistory = load(FILES.gameHistory, []);

// ===== LIVE GAME CONTROL (Master decision + side totals) =====
const GAME_SIDES = {
  dragon:     ['Dragon', 'Tiger', 'Tie'],
  andarbahar: ['Andar', 'Bahar'],
  teenpatti:  ['A', 'B'],
  lucky7:     ['down', 'exact', 'up']
};
const GAME_LABELS = {
  dragon: 'Dragon Tiger',
  andarbahar: 'Andar Bahar',
  teenpatti: 'Teen Patti',
  lucky7: 'Lucky 7'
};

function makeLiveGame(id) {
  const sides = {};
  (GAME_SIDES[id] || []).forEach(s => { sides[s] = 0; });
  return {
    id,
    name: GAME_LABELS[id] || id,
    roundId: null,
    phase: 'idle',
    timer: 0,
    sides,
    forcedWinner: null,
    lastWinner: null,
    lastRoundId: null,
    betLog: []
  };
}

let liveGames = {
  dragon: makeLiveGame('dragon'),
  andarbahar: makeLiveGame('andarbahar'),
  teenpatti: makeLiveGame('teenpatti'),
  lucky7: makeLiveGame('lucky7')
};

function broadcastLive(gameId) {
  const g = liveGames[gameId];
  if (!g) return;
  io.to('master').emit('live_game_update', g);
  io.to('game_' + gameId).emit('live_game_update', g);
}

function resetLiveSides(gameId, roundId) {
  const g = liveGames[gameId];
  if (!g) return;
  Object.keys(g.sides).forEach(s => { g.sides[s] = 0; });
  g.roundId = roundId || ('R-' + Date.now().toString(36).toUpperCase());
  g.phase = 'betting';
  g.forcedWinner = null;
  g.betLog = [];
  broadcastLive(gameId);
}

// Ensure Master exists
if (!users['master']) {
  users['master'] = {
    id: uuidv4(),
    username: 'master',
    password: bcrypt.hashSync('master123', 8),
    role: 'master',
    coins: 0,
    sharePercent: 0,
    isActive: true,
    parent: null,
    createdAt: new Date().toISOString(),
    token: null
  };
  save(FILES.users, users);
}
save(FILES.games, games);
save(FILES.settings, settings);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '5mb' }));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/master', (req, res) => res.sendFile(path.join(__dirname, 'public', 'master.html')));
app.get('/agent', (req, res) => res.sendFile(path.join(__dirname, 'public', 'agent.html')));

function pushRecord(list, file, record, limit = 5000) {
  list.unshift(record);
  if (list.length > limit) list.length = limit;
  save(file, list);
}

function getHistoryFor(role, username) {
  if (role === 'master') return { transactions: transactions.slice(0, 500), gameHistory: gameHistory.slice(0, 500) };
  if (role === 'agent') {
    const playerNames = new Set(Object.values(users).filter(u => u.role === 'player' && u.parent === username).map(u => u.username));
    return {
      transactions: transactions.filter(t => playerNames.has(t.username)).slice(0, 500),
      gameHistory: gameHistory.filter(g => playerNames.has(g.username)).slice(0, 500)
    };
  }
  return {
    transactions: transactions.filter(t => t.username === username).slice(0, 200),
    gameHistory: gameHistory.filter(g => g.username === username).slice(0, 200)
  };
}

app.post('/api/game-access', (req, res) => {
  const { username, token, gameId } = req.body || {};
  const uname = String(username || '').trim().toLowerCase();
  const u = users[uname];
  const g = games[gameId];
  if (!u || u.role !== 'player' || !u.isActive || !token || u.token !== token) {
    return res.status(401).json({ success: false, message: 'Invalid Libra 24 session' });
  }
  if (!g || !g.active) return res.status(403).json({ success: false, message: 'Game is currently unavailable' });
  res.json({ success: true, user: { username: u.username, role: u.role, coins: Number(u.coins || 0), parent: u.parent || null } });
});

io.on('connection', (socket) => {
  socket.on('login', ({ username, password }, cb) => {
    username = (username || '').trim().toLowerCase();
    const u = users[username];
    if (!u || !u.isActive) return cb({ success: false, message: 'Invalid ID or inactive' });
    if (!bcrypt.compareSync(password, u.password)) return cb({ success: false, message: 'Wrong password' });

    u.token = crypto.randomBytes(20).toString('hex');
    u.lastLogin = new Date().toISOString();
    save(FILES.users, users);

    socket.username = username;
    socket.role = u.role;
    socket.join(u.role);
    if (u.role === 'agent') socket.join('agent_' + username);
    if (u.role === 'player' && u.parent) socket.join('agent_' + u.parent);

    cb({
      success: true,
      user: {
        username: u.username,
        role: u.role,
        coins: u.coins,
        token: u.token,
        parent: u.parent || null
      }
    });
  });

  socket.on('auth', ({ username, token }, cb) => {
    username = (username || '').trim().toLowerCase();
    const u = users[username];
    if (!u || !u.token || u.token !== token) return cb && cb({ success: false });
    socket.username = username;
    socket.role = u.role;
    socket.join(u.role);
    if (u.role === 'agent') socket.join('agent_' + username);
    if (u.role === 'player' && u.parent) socket.join('agent_' + u.parent);
    cb && cb({ success: true });
  });
