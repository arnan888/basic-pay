const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;
const SECRET_KEY = 'longhu_secret_key_2024';

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// 初始化数据库
const db = new sqlite3.Database('./database.sqlite');

db.serialize(() => {
  // 用户表
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    balance INTEGER DEFAULT 1000,
    total_bet INTEGER DEFAULT 0,
    total_win INTEGER DEFAULT 0,
    total_rounds INTEGER DEFAULT 0,
    win_count INTEGER DEFAULT 0,
    max_streak INTEGER DEFAULT 0,
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  // 充值订单表
  db.run(`CREATE TABLE IF NOT EXISTS recharges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT UNIQUE,
    user_id INTEGER,
    amount INTEGER,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  // 提现订单表
  db.run(`CREATE TABLE IF NOT EXISTS withdraws (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    amount INTEGER,
    account TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  // 游戏记录表
  db.run(`CREATE TABLE IF NOT EXISTS game_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    bet_dragon INTEGER DEFAULT 0,
    bet_tiger INTEGER DEFAULT 0,
    bet_tie INTEGER DEFAULT 0,
    result TEXT,
    win_amount INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  // 系统配置表
  db.run(`CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
  
  // 插入默认配置
  const defaultConfig = [
    ['dragon_odds', '2'],
    ['tiger_odds', '2'],
    ['tie_odds', '8'],
    ['dragon_weight', '45'],
    ['tiger_weight', '45'],
    ['tie_weight', '10'],
    ['min_bet', '10'],
    ['max_bet', '10000'],
    ['maintenance_mode', '0']
  ];
  defaultConfig.forEach(([key, val]) => {
    db.run(`INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)`, [key, val]);
  });
  
  // 创建管理员账号（admin / admin123）
  const adminHash = bcrypt.hashSync('admin123', 10);
  db.run(`INSERT OR IGNORE INTO users (id, username, password, balance, is_admin) VALUES (1, 'admin', ?, 999999, 1)`, [adminHash]);
});

// ========== 辅助函数 ==========
function getConfig(key, callback) {
  db.get(`SELECT value FROM config WHERE key = ?`, [key], (err, row) => {
    callback(err, row ? row.value : null);
  });
}

// ========== 用户API ==========
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ code: 400, msg: '用户名密码不能为空' });
  const hashed = bcrypt.hashSync(password, 10);
  db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, hashed], function(err) {
    if (err) return res.json({ code: 400, msg: '用户名已存在' });
    res.json({ code: 200, msg: '注册成功', userId: this.lastID });
  });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
    if (err || !user) return res.json({ code: 400, msg: '用户不存在' });
    if (!bcrypt.compareSync(password, user.password)) return res.json({ code: 400, msg: '密码错误' });
    const token = jwt.sign({ id: user.id, username: user.username, isAdmin: user.is_admin === 1 }, SECRET_KEY, { expiresIn: '7d' });
    res.json({ code: 200, msg: '登录成功', token, user: { id: user.id, username: user.username, balance: user.balance, isAdmin: user.is_admin === 1 } });
  });
});

app.get('/api/user/:id', (req, res) => {
  db.get(`SELECT id, username, balance, total_bet, total_win, total_rounds, win_count, max_streak FROM users WHERE id = ?`, [req.params.id], (err, user) => {
    if (!user) return res.json({ code: 400, msg: '用户不存在' });
    res.json({ code: 200, data: user });
  });
});

app.post('/api/update_balance', (req, res) => {
  const { userId, delta } = req.body;
  db.run(`UPDATE users SET balance = balance + ? WHERE id = ?`, [delta, userId], function(err) {
    if (err) return res.json({ code: 500, msg: '更新失败' });
    res.json({ code: 200, msg: '更新成功' });
  });
});

// ========== 充值/提现API ==========
app.post('/api/recharge', (req, res) => {
  const { userId, amount } = req.body;
  const orderNo = 'RC' + Date.now() + Math.floor(Math.random() * 10000);
  db.run(`INSERT INTO recharges (order_no, user_id, amount, status) VALUES (?, ?, ?, 'completed')`, [orderNo, userId, amount], function(err) {
    if (err) return res.json({ code: 500, msg: '创建订单失败' });
    db.run(`UPDATE users SET balance = balance + ? WHERE id = ?`, [amount, userId]);
    res.json({ code: 200, msg: '充值成功', orderNo });
  });
});

app.post('/api/withdraw', (req, res) => {
  const { userId, amount, account } = req.body;
  db.get(`SELECT balance FROM users WHERE id = ?`, [userId], (err, user) => {
    if (!user || user.balance < amount) return res.json({ code: 400, msg: '余额不足' });
    db.run(`INSERT INTO withdraws (user_id, amount, account, status) VALUES (?, ?, ?, 'pending')`, [userId, amount, account], function(err) {
      if (err) return res.json({ code: 500, msg: '申请失败' });
      db.run(`UPDATE users SET balance = balance - ? WHERE id = ?`, [amount, userId]);
      res.json({ code: 200, msg: '提现申请已提交，等待审核' });
    });
  });
});

// ========== 游戏API ==========
app.post('/api/bet', (req, res) => {
  const { userId, betDragon, betTiger, betTie } = req.body;
  const totalBet = betDragon + betTiger + betTie;
  if (totalBet <= 0) return res.json({ code: 400, msg: '请下注' });
  
  db.get(`SELECT balance FROM users WHERE id = ?`, [userId], (err, user) => {
    if (!user || user.balance < totalBet) return res.json({ code: 400, msg: '余额不足' });
    
    db.run(`UPDATE users SET balance = balance - ?, total_bet = total_bet + ? WHERE id = ?`, [totalBet, totalBet, userId]);
    
    getConfig('dragon_odds', (err, dragonOdds) => {
      getConfig('tiger_odds', (err, tigerOdds) => {
        getConfig('tie_odds', (err, tieOdds) => {
          getConfig('dragon_weight', (err, dw) => {
            getConfig('tiger_weight', (err, tw) => {
              const dragonW = parseInt(dw) || 45;
              const tigerW = parseInt(tw) || 45;
              const rand = Math.random() * 100;
              let result = '';
              if (rand < dragonW) result = 'dragon';
              else if (rand < dragonW + tigerW) result = 'tiger';
              else result = 'tie';
              
              let winAmount = 0;
              if (result === 'dragon' && betDragon > 0) winAmount = betDragon * (parseFloat(dragonOdds) || 2);
              else if (result === 'tiger' && betTiger > 0) winAmount = betTiger * (parseFloat(tigerOdds) || 2);
              else if (result === 'tie' && betTie > 0) winAmount = betTie * (parseFloat(tieOdds) || 8);
              
              let resultText = { dragon: '龙', tiger: '虎', tie: '和' }[result];
              
              if (winAmount > 0) {
                db.run(`UPDATE users SET balance = balance + ?, total_win = total_win + ?, win_count = win_count + 1 WHERE id = ?`, [winAmount, winAmount, userId]);
              }
              
              db.run(`UPDATE users SET total_rounds = total_rounds + 1 WHERE id = ?`, [userId]);
              
              db.run(`INSERT INTO game_records (user_id, bet_dragon, bet_tiger, bet_tie, result, win_amount) VALUES (?, ?, ?, ?, ?, ?)`, [userId, betDragon, betTiger, betTie, resultText, winAmount]);
              
              db.get(`SELECT balance FROM users WHERE id = ?`, [userId], (err, updatedUser) => {
                res.json({ code: 200, result: resultText, winAmount, newBalance: updatedUser.balance });
              });
            });
          });
        });
      });
    });
  });
});

// ========== 管理后台API ==========
app.get('/api/admin/users', (req, res) => {
  db.all(`SELECT id, username, balance, total_bet, total_win, total_rounds, win_count, max_streak, created_at FROM users WHERE username != 'admin' ORDER BY id DESC`, [], (err, users) => {
    res.json({ code: 200, data: users });
  });
});

app.post('/api/admin/update_balance', (req, res) => {
  const { userId, amount, reason } = req.body;
  db.run(`UPDATE users SET balance = balance + ? WHERE id = ?`, [amount, userId], function(err) {
    if (err) return res.json({ code: 500, msg: '操作失败' });
    res.json({ code: 200, msg: '余额已更新' });
  });
});

app.get('/api/admin/withdraws', (req, res) => {
  db.all(`SELECT w.*, u.username FROM withdraws w JOIN users u ON w.user_id = u.id WHERE w.status = 'pending' ORDER BY w.id DESC`, [], (err, list) => {
    res.json({ code: 200, data: list });
  });
});

app.post('/api/admin/withdraw_process', (req, res) => {
  const { id, action } = req.body;
  const status = action === 'approve' ? 'approved' : 'rejected';
  db.run(`UPDATE withdraws SET status = ? WHERE id = ?`, [status, id], function(err) {
    if (err) return res.json({ code: 500, msg: '操作失败' });
    res.json({ code: 200, msg: '处理成功' });
  });
});

app.get('/api/admin/recharges', (req, res) => {
  db.all(`SELECT r.*, u.username FROM recharges r JOIN users u ON r.user_id = u.id ORDER BY r.id DESC LIMIT 100`, [], (err, list) => {
    res.json({ code: 200, data: list });
  });
});

app.get('/api/admin/config', (req, res) => {
  db.all(`SELECT * FROM config`, [], (err, configs) => {
    const obj = {};
    configs.forEach(c => { obj[c.key] = c.value; });
    res.json({ code: 200, data: obj });
  });
});

app.post('/api/admin/config', (req, res) => {
  const updates = req.body;
  const stmt = db.prepare(`UPDATE config SET value = ? WHERE key = ?`);
  for (const [key, value] of Object.entries(updates)) {
    stmt.run([value, key]);
  }
  stmt.finalize();
  res.json({ code: 200, msg: '配置已更新' });
});

app.get('/api/admin/stats', (req, res) => {
  db.get(`SELECT COUNT(*) as total_users, SUM(balance) as total_balance FROM users WHERE username != 'admin'`, [], (err, userStats) => {
    db.get(`SELECT COUNT(*) as total_orders, SUM(amount) as total_amount FROM recharges WHERE status = 'completed'`, [], (err, rechargeStats) => {
      db.get(`SELECT COUNT(*) as total_rounds, SUM(win_amount) as total_payout FROM game_records`, [], (err, gameStats) => {
        res.json({ code: 200, data: { users: userStats, recharges: rechargeStats, games: gameStats } });
      });
    });
  });
});

// WebSocket实时推送
wss.on('connection', (ws) => {
  console.log('新客户端连接');
  ws.on('close', () => console.log('客户端断开'));
});

function broadcastResult(result) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'result', data: result }));
    }
  });
}

server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log(`管理员账号: admin / admin123`);
});