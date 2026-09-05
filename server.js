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
  notifyAgents: [] // agent usernames who receive enter notifications
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
    phase: 'idle', // idle | betting | locked | result
    timer: 0,
    sides,
    forcedWinner: null,   // master decision for next/current round
    lastWinner: null,
    lastRoundId: null,
    betLog: []            // recent individual bets [{user,side,amount,time}]
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

    // Notification: Player entered site
    if (u.role === 'player') {
      const msg = {
        id: uuidv4(),
        type: 'site_enter',
        text: `Player ${u.username} (Coins: ${u.coins}) entered Libra 24`,
        username: u.username,
        coins: u.coins,
        time: new Date().toISOString()
      };
      notifications.unshift(msg);
      if (notifications.length > 200) notifications.pop();
      save(FILES.notifs, notifications);

      io.to('master').emit('notification', msg);
      (settings.notifyAgents || []).forEach(ag => {
        io.to('agent_' + ag).emit('notification', msg);
      });
    }

    cb({
      success: true,
      user: {
        username: u.username,
        role: u.role,
        coins: u.coins,
        sharePercent: u.sharePercent || 0,
        token: u.token,
        parent: u.parent
      }
    });
  });

  socket.on('auth', ({ username, token }, cb) => {
    const u = users[username];
    if (!u || u.token !== token) return cb({ success: false });
    socket.username = username;
    socket.role = u.role;
    socket.join(u.role);
    if (u.role === 'agent') socket.join('agent_' + username);
    if (u.role === 'player' && u.parent) socket.join('agent_' + u.parent);
    cb({ success: true, user: { username: u.username, role: u.role, coins: u.coins, sharePercent: u.sharePercent || 0, parent: u.parent } });
  });

  // ===== MASTER ACTIONS =====
  socket.on('master_create_agent', ({ username, password, sharePercent, coins }, cb) => {
    if (socket.role !== 'master') return cb({ success: false });
    username = (username || '').trim().toLowerCase();
    if (!username || !password) return cb({ success: false, message: 'Required' });
    if (users[username]) return cb({ success: false, message: 'Already exists' });

    users[username] = {
      id: uuidv4(),
      username,
      password: bcrypt.hashSync(password, 8),
      role: 'agent',
      coins: Number(coins) || 0,
      sharePercent: Number(sharePercent) || 0,
      isActive: true,
      parent: 'master',
      createdAt: new Date().toISOString(),
      token: null
    };
    save(FILES.users, users);
    io.to('master').emit('users_updated', getSafeUsers());
    cb({ success: true });
  });

  socket.on('master_create_player', ({ username, password, coins, agent }, cb) => {
    if (socket.role !== 'master' && socket.role !== 'agent') return cb({ success: false });
    username = (username || '').trim().toLowerCase();
    if (!username || !password) return cb({ success: false, message: 'Required' });
    if (users[username]) return cb({ success: false, message: 'Already exists' });

    const parent = socket.role === 'master' ? (agent || null) : socket.username;

    users[username] = {
      id: uuidv4(),
      username,
      password: bcrypt.hashSync(password, 8),
      role: 'player',
      coins: Number(coins) || 0,
      sharePercent: 0,
      isActive: true,
      parent,
      createdAt: new Date().toISOString(),
      token: null
    };
    save(FILES.users, users);
    io.to('master').emit('users_updated', getSafeUsers());
    if (parent) io.to('agent_' + parent).emit('users_updated', getSafeUsers());
    cb({ success: true });
  });

  socket.on('update_coins', ({ username, amount }, cb) => {
    if (socket.role !== 'master' && socket.role !== 'agent') return cb({ success: false });
    const u = users[username];
    if (!u) return cb({ success: false, message: 'Not found' });
    if (socket.role === 'agent' && u.parent !== socket.username) return cb({ success: false, message: 'Not your player' });

    const delta = Number(amount) || 0;
    const before = Number(u.coins || 0);
    const after = Math.max(0, before + delta);
    u.coins = after;
    const actualDelta = after - before;
    pushRecord(transactions, FILES.transactions, {
      id: uuidv4(), username, parent: u.parent || null, actor: socket.username,
      actorRole: socket.role, type: actualDelta >= 0 ? 'credit' : 'debit',
      amount: Math.abs(actualDelta), delta: actualDelta, before, after,
      time: new Date().toISOString()
    });
    save(FILES.users, users);
    io.emit('balance_update', { username, coins: u.coins });
    io.to('master').emit('users_updated', getSafeUsers());
    cb({ success: true, coins: u.coins });
  });

  socket.on('toggle_user', ({ username, active }, cb) => {
    if (socket.role !== 'master' && socket.role !== 'agent') return cb({ success: false });
    const u = users[username];
    if (!u) return cb({ success: false });
    if (socket.role === 'agent' && u.parent !== socket.username) return cb({ success: false });
    u.isActive = !!active;
    save(FILES.users, users);
    io.to('master').emit('users_updated', getSafeUsers());
    cb({ success: true });
  });

  socket.on('set_share', ({ username, percent }, cb) => {
    if (socket.role !== 'master') return cb({ success: false });
    const u = users[username];
    if (!u || u.role !== 'agent') return cb({ success: false });
    u.sharePercent = Number(percent) || 0;
    save(FILES.users, users);
    io.to('master').emit('users_updated', getSafeUsers());
    cb({ success: true });
  });

  socket.on('update_game', ({ id, name, image, url, active }, cb) => {
    if (socket.role !== 'master') return cb({ success: false });
    if (!games[id]) games[id] = { id, order: Object.keys(games).length + 1 };
    if (name !== undefined) games[id].name = name;
    if (image !== undefined) games[id].image = image;
    if (url !== undefined) games[id].url = url;
    if (active !== undefined) games[id].active = active;
    save(FILES.games, games);
    io.emit('games_updated', games);
    cb({ success: true });
  });

  socket.on('set_notify_agents', ({ agents }, cb) => {
    if (socket.role !== 'master') return cb({ success: false });
    settings.notifyAgents = agents || [];
    save(FILES.settings, settings);
    cb({ success: true });
  });

  socket.on('master_update_profile', ({ newUsername, newPassword, currentPassword }, cb) => {
    if (socket.role !== 'master') return cb({ success: false });
    const u = users[socket.username];
    if (!u) return cb({ success: false, message: 'Not found' });

    // Verify current password if changing password
    if (newPassword && newPassword.length > 0) {
      if (!currentPassword || !bcrypt.compareSync(currentPassword, u.password)) {
        return cb({ success: false, message: 'Current password galat hai' });
      }
      if (newPassword.length < 4) return cb({ success: false, message: 'New password kam se kam 4 characters' });
      u.password = bcrypt.hashSync(newPassword, 8);
    }

    // Change username
    if (newUsername && newUsername.trim() && newUsername.trim().toLowerCase() !== socket.username) {
      const nu = newUsername.trim().toLowerCase();
      if (users[nu]) return cb({ success: false, message: 'Username already exists' });
      users[nu] = { ...u, username: nu };
      delete users[socket.username];
      socket.username = nu;
      u.username = nu;
    }

    save(FILES.users, users);
    u.token = crypto.randomBytes(20).toString('hex');
    save(FILES.users, users);

    cb({
      success: true,
      user: {
        username: u.username,
        role: u.role,
        coins: u.coins,
        token: u.token
      }
    });
  });

  socket.on('player_enter_game', ({ gameId }, cb) => {
    if (socket.role !== 'player') return cb({ success: false });
    const u = users[socket.username];
    const g = games[gameId];
    if (!u || !g) return cb({ success: false });

    const msg = {
      id: uuidv4(),
      type: 'game_enter',
      text: `Player ${u.username} (Coins: ${u.coins}) entered ${g.name}`,
      username: u.username,
      coins: u.coins,
      game: g.name,
      time: new Date().toISOString()
    };
    pushRecord(gameHistory, FILES.gameHistory, {
      id: uuidv4(), username: u.username, parent: u.parent || null,
      gameId: g.id, game: g.name, coins: u.coins, time: msg.time
    });
    notifications.unshift(msg);
    if (notifications.length > 200) notifications.pop();
    save(FILES.notifs, notifications);

    io.to('master').emit('notification', msg);
    (settings.notifyAgents || []).forEach(ag => io.to('agent_' + ag).emit('notification', msg));
    cb({ success: true, url: g.url });
  });

  // Player/game reports a bet → aggregate side totals for master
  socket.on('live_bet', (data) => {
    const gameId = data && data.gameId;
    let side = data && data.side;
    const amount = Math.abs(Number(data && data.amount) || 0);
    if (!gameId || !liveGames[gameId] || !side || amount <= 0) {
      io.to('master').emit('live_bet', data || {});
      return;
    }
    // normalize side names
    const sideMap = {
      dragon: 'Dragon', tiger: 'Tiger', tie: 'Tie',
      andar: 'Andar', bahar: 'Bahar',
      a: 'A', b: 'B',
      down: 'down', exact: 'exact', up: 'up',
      '7 down': 'down', '7 up': 'up', 'exact 7': 'exact'
    };
    const key = String(side).trim();
    side = sideMap[key.toLowerCase()] || sideMap[key] || key;

    const g = liveGames[gameId];
    // new round → reset totals first
    if (data.roundId && data.roundId !== g.roundId) {
      Object.keys(g.sides).forEach(s => { g.sides[s] = 0; });
      g.roundId = data.roundId;
      g.phase = 'betting';
      g.forcedWinner = null;
      g.betLog = [];
    }
    if (g.sides[side] === undefined) {
      // unknown side — still track under given name
      g.sides[side] = 0;
    }
    g.sides[side] += amount;
    g.phase = g.phase || 'betting';
    g.betLog.unshift({
      username: (data.username || socket.username || '?'),
      side,
      amount,
      time: new Date().toISOString()
    });
    if (g.betLog.length > 40) g.betLog.length = 40;
    broadcastLive(gameId);
    io.to('master').emit('live_bet', {
      username: data.username || socket.username,
      game: GAME_LABELS[gameId] || gameId,
      gameId,
      bet: side,
      amount,
      sides: { ...g.sides },
      roundId: g.roundId
    });
  });

  // Game clients join their room + report round phase
  socket.on('join_game_room', ({ gameId }, cb) => {
    if (!liveGames[gameId]) return cb && cb({ success: false });
    socket.join('game_' + gameId);
    socket.gameId = gameId;
    cb && cb({ success: true, state: liveGames[gameId] });
  });

  socket.on('game_round_sync', ({ gameId, roundId, phase, timer }) => {
    const g = liveGames[gameId];
    if (!g) return;
    if (roundId && roundId !== g.roundId) {
      resetLiveSides(gameId, roundId);
    }
    if (phase) g.phase = phase;
    if (typeof timer === 'number') g.timer = timer;
    broadcastLive(gameId);
  });

  socket.on('game_result_report', ({ gameId, roundId, winner }) => {
    const g = liveGames[gameId];
    if (!g) return;
    g.lastWinner = winner;
    g.lastRoundId = roundId || g.roundId;
    g.phase = 'result';
    g.forcedWinner = null;
    broadcastLive(gameId);
  });

  // Master forces next/current result for a game
  socket.on('master_force_result', ({ gameId, winner }, cb) => {
    if (socket.role !== 'master') return cb && cb({ success: false, message: 'Master only' });
    const g = liveGames[gameId];
    if (!g) return cb && cb({ success: false, message: 'Unknown game' });
    const sides = GAME_SIDES[gameId] || [];
    if (winner && !sides.includes(winner)) {
      return cb && cb({ success: false, message: 'Invalid side: ' + winner });
    }
    g.forcedWinner = winner || null;
    broadcastLive(gameId);
    io.to('game_' + gameId).emit('master_force_result', { gameId, winner: g.forcedWinner, roundId: g.roundId });
    cb && cb({ success: true, forcedWinner: g.forcedWinner });
  });

  socket.on('master_clear_force', ({ gameId }, cb) => {
    if (socket.role !== 'master') return cb && cb({ success: false });
    const g = liveGames[gameId];
    if (!g) return cb && cb({ success: false });
    g.forcedWinner = null;
    broadcastLive(gameId);
    io.to('game_' + gameId).emit('master_force_result', { gameId, winner: null, roundId: g.roundId });
    cb && cb({ success: true });
  });

  socket.on('master_reset_sides', ({ gameId }, cb) => {
    if (socket.role !== 'master') return cb && cb({ success: false });
    if (!liveGames[gameId]) return cb && cb({ success: false });
    resetLiveSides(gameId, 'R-' + Date.now().toString(36).toUpperCase());
    cb && cb({ success: true, state: liveGames[gameId] });
  });

  socket.on('get_live_games', (cb) => {
    if (socket.role !== 'master') return cb && cb({ success: false });
    cb && cb({ success: true, liveGames });
  });

  socket.on('get_state', () => {
    const safe = getSafeUsers();
    if (socket.role === 'master') {
      socket.emit('full_state', { users: safe, games, settings, notifications: notifications.slice(0, 50), liveGames, ...getHistoryFor('master') });
    } else if (socket.role === 'agent') {
      const myPlayers = {};
      Object.values(safe).forEach(u => {
        if (u.parent === socket.username || u.username === socket.username) myPlayers[u.username] = u;
      });
      socket.emit('agent_state', { users: myPlayers, games, notifications: notifications.filter(n => n.username && users[n.username]?.parent === socket.username).slice(0, 30), ...getHistoryFor('agent', socket.username) });
    } else if (socket.role === 'player') {
      const u = users[socket.username];
      socket.emit('player_state', { coins: u?.coins || 0, games, ...getHistoryFor('player', socket.username) });
    }
  });

  socket.on('disconnect', () => {});
});

function getSafeUsers() {
  const out = {};
  Object.values(users).forEach(u => {
    out[u.username] = {
      username: u.username,
      role: u.role,
      coins: u.coins,
      sharePercent: u.sharePercent || 0,
      isActive: u.isActive,
      parent: u.parent,
      createdAt: u.createdAt,
      lastLogin: u.lastLogin,
      totalCredit: transactions.filter(t => t.username === u.username && t.delta > 0).reduce((a,t) => a + t.delta, 0),
      totalDebit: transactions.filter(t => t.username === u.username && t.delta < 0).reduce((a,t) => a + Math.abs(t.delta), 0),
      netChange: transactions.filter(t => t.username === u.username).reduce((a,t) => a + t.delta, 0),
      gameEntries: gameHistory.filter(g => g.username === u.username).length
    };
  });
  return out;
}

server.listen(PORT, () => {
  console.log(`Libra 24 running on http://localhost:${PORT}`);
  console.log(`Master login: master / master123`);
});
