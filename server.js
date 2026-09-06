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

console.log('Libra24 server starting...');
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/login'));
app.get('/health', (req, res) => res.json({ ok: true }));

// Temporary minimal boot - full server restoring next commit
const USERS_FILE = path.join(DATA, 'users.json');
function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch(e) { return {}; }
}
function saveUsers(u) { fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2)); }
let users = loadUsers();
if (!users.master) {
  users.master = { id: '1', username: 'master', password: bcrypt.hashSync('master123', 8), role: 'master', coins: 0, isActive: true, token: null };
  saveUsers(users);
}

io.on('connection', (socket) => {
  socket.on('auth', ({ username, token }, cb) => {
    const u = users[String(username||'').toLowerCase()];
    if (!u) return cb && cb({ success: false, message: 'User not found' });
    socket.username = u.username;
    socket.role = u.role;
    if (u.role === 'master') socket.join('master');
    cb && cb({ success: true, user: { username: u.username, role: u.role, coins: u.coins } });
  });
});

server.listen(PORT, () => console.log('Libra24 on', PORT));
