const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// 提供前端静态文件（game 目录）
app.use(express.static(path.join(__dirname, 'game')));

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const RECHARGE_FILE = path.join(DATA_DIR, 'recharges.json');
const WITHDRAW_FILE = path.join(DATA_DIR, 'withdraws.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

function readJSON(filePath, defaultValue = []) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (e) { console.error('读取失败:', e); }
  return defaultValue;
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function initData() {
  if (!fs.existsSync(USERS_FILE)) {
    const defaultUsers = [
      { account: "admin", password: "admin888", balance: 50000, vipLevel: 0, betPoints: 0, lastWeekClaim: "", records: [] },
      { account: "test1", password: "123456", balance: 10000, vipLevel: 0, betPoints: 0, lastWeekClaim: "", records: [] }
    ];
    writeJSON(USERS_FILE, defaultUsers);
  }
  if (!fs.existsSync(CONFIG_FILE)) {
    const defaultConfig = {
      bankerBalance: 200000,
      adjustFactor: 0.98,
      probWeight: 50,
      serviceFee: 0.02
    };
    writeJSON(CONFIG_FILE, defaultConfig);
  }
  if (!fs.existsSync(RECHARGE_FILE)) writeJSON(RECHARGE_FILE, []);
  if (!fs.existsSync(WITHDRAW_FILE)) writeJSON(WITHDRAW_FILE, []);
}
initData();

// ================== VIP 规则与升级逻辑 ==================
const vipRules = [
  { level: 1,  requiredBet: 30000,    award: 15,  weekly: 0 },
  { level: 2,  requiredBet: 100000,   award: 30,  weekly: 3 },
  { level: 3,  requiredBet: 250000,   award: 55,  weekly: 5 },
  { level: 4,  requiredBet: 500000,   award: 100, weekly: 8 },
  { level: 5,  requiredBet: 1000000,  award: 200, weekly: 15 },
  { level: 6,  requiredBet: 2000000,  award: 400, weekly: 30 },
  { level: 7,  requiredBet: 3000000,  award: 550, weekly: 55 },
  { level: 8,  requiredBet: 4000000,  award: 700, weekly: 85 },
  { level: 9,  requiredBet: 5000000,  award: 800, weekly: 110 },
  { level: 10, requiredBet: 6000000,  award: 800, weekly: 130 }
];

function checkVipUpgrade(user) {
  let newLevel = user.vipLevel || 0;
  let totalAward = 0;
  for (let rule of vipRules) {
    if (user.betPoints >= rule.requiredBet && rule.level > newLevel) {
      newLevel = rule.level;
      totalAward += rule.award;
    }
  }
  if (newLevel > (user.vipLevel || 0)) {
    user.vipLevel = newLevel;
    user.balance += totalAward;
    return { upgraded: true, totalAward, newLevel };
  }
  return { upgraded: false };
}

// ================== API 路由 ==================
app.get('/api/ping', (req, res) => res.json({ ok: true }));

app.get('/api/users', (req, res) => {
  const users = readJSON(USERS_FILE);
  res.json(users.map(u => ({ account: u.account, balance: u.balance, records: u.records })));
});

app.put('/api/user/:account/balance', (req, res) => {
  const { account } = req.params;
  const { balance } = req.body;
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.account === account);
  if (!user) return res.status(404).json({ msg: '用户不存在' });
  user.balance = balance;
  writeJSON(USERS_FILE, users);
  res.json({ msg: 'ok' });
});

app.put('/api/users/batch', (req, res) => {
  writeJSON(USERS_FILE, req.body.users);
  res.json({ msg: 'ok' });
});

app.get('/api/config', (req, res) => res.json(readJSON(CONFIG_FILE)));
app.put('/api/config', (req, res) => {
  const config = { ...readJSON(CONFIG_FILE), ...req.body };
  writeJSON(CONFIG_FILE, config);
  res.json(config);
});

app.post('/api/recharge', (req, res) => {
  const { account, amount } = req.body;
  if (!account || !amount || amount <= 0) return res.status(400).json({ msg: '参数错误' });
  const recharges = readJSON(RECHARGE_FILE);
  const order = { id: Date.now(), account, amount, status: 'pending', time: new Date().toLocaleString() };
  recharges.push(order);
  writeJSON(RECHARGE_FILE, recharges);
  res.json({ msg: '充值申请已提交', order });
});

app.get('/api/recharges/pending', (req, res) => res.json(readJSON(RECHARGE_FILE)));

app.put('/api/recharge/:id', (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  const recharges = readJSON(RECHARGE_FILE);
  const order = recharges.find(o => o.id === id);
  if (!order) return res.status(404).json({ msg: '订单不存在' });
  // 批准时自动加余额
  if (status === 'approved' && order.status !== 'approved') {
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.account === order.account);
    if (user) {
      user.balance += order.amount;
      writeJSON(USERS_FILE, users);
    }
  }
  order.status = status;
  writeJSON(RECHARGE_FILE, recharges);
  res.json({ msg: '更新成功', order });
});

app.post('/api/withdraw', (req, res) => {
  const { account, amount, address } = req.body;
  if (!account || !amount || amount <= 0 || !address) return res.status(400).json({ msg: '参数错误' });
  const withdraws = readJSON(WITHDRAW_FILE);
  const order = { id: Date.now(), account, amount, address, status: 'pending', time: new Date().toLocaleString() };
  withdraws.push(order);
  writeJSON(WITHDRAW_FILE, withdraws);
  res.json({ msg: '提现申请已提交', order });
});

app.get('/api/withdraws/pending', (req, res) => res.json(readJSON(WITHDRAW_FILE)));

app.put('/api/withdraw/:id', (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  const withdraws = readJSON(WITHDRAW_FILE);
  const order = withdraws.find(o => o.id === id);
  if (!order) return res.status(404).json({ msg: '订单不存在' });
  order.status = status;
  writeJSON(WITHDRAW_FILE, withdraws);
  res.json({ msg: '更新成功', order });
});

// 更新积分并自动升级
app.put('/api/user/:account/vipdata', (req, res) => {
  const { account } = req.params;
  const { betPoints, balance } = req.body;
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.account === account);
  if (!user) return res.status(404).json({ msg: '用户不存在' });
  if (balance !== undefined) user.balance = balance;
  if (betPoints !== undefined) user.betPoints = betPoints;
  const result = checkVipUpgrade(user);
  writeJSON(USERS_FILE, users);
  res.json({
    msg: 'ok',
    user: { account: user.account, balance: user.balance, vipLevel: user.vipLevel, betPoints: user.betPoints },
    vipUpgrade: result
  });
});

// 领取周工资
app.post('/api/user/:account/vip/weekly', (req, res) => {
  const { account } = req.params;
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.account === account);
  if (!user) return res.status(404).json({ msg: '用户不存在' });
  const level = user.vipLevel || 0;
  const rule = vipRules.find(r => r.level === level);
  if (!rule || rule.weekly === 0) {
    return res.status(400).json({ msg: '当前等级无周工资' });
  }
  const now = new Date();
  const weekOfMonth = Math.ceil(now.getDate() / 7);
  const claimKey = `${now.getFullYear()}-${now.getMonth() + 1}-W${weekOfMonth}`;
  if (user.lastWeekClaim === claimKey) {
    return res.status(400).json({ msg: '本周已领取' });
  }
  const salary = rule.weekly;
  user.balance += salary;
  user.lastWeekClaim = claimKey;
  writeJSON(USERS_FILE, users);
  res.json({ msg: `领取成功，获得 ${salary} USDT`, balance: user.balance });
});

// 其他路由返回 index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'game', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 服务已启动: http://0.0.0.0:${PORT}`);
});





require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!JWT_SECRET || !ADMIN_PASSWORD) {
    console.error('❌ 请在 .env 文件中设置 JWT_SECRET 和 ADMIN_PASSWORD');
    process.exit(1);
}

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// 数据库
const db = new sqlite3.Database(process.env.DB_PATH || './game.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        balance REAL DEFAULT 0,
        register_time TEXT,
        records TEXT DEFAULT '[]',
        result_history TEXT DEFAULT '[]'
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS pending_recharges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        amount REAL NOT NULL,
        tx_hash TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS withdraws (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        amount REAL NOT NULL,
        address TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS system_config (
        key TEXT PRIMARY KEY,
        value REAL
    )`);
    db.run(`INSERT OR IGNORE INTO system_config (key, value) VALUES ('systemBankerBalance', 50000)`);
    db.run(`INSERT OR IGNORE INTO system_config (key, value) VALUES ('adjustFactor', 1.0)`);
});

// 辅助函数
function getConfig(key) {
    return new Promise((resolve, reject) => {
        db.get('SELECT value FROM system_config WHERE key = ?', [key], (err, row) => {
            if (err) reject(err);
            else resolve(row ? row.value : null);
        });
    });
}
function setConfig(key, value) {
    return new Promise((resolve, reject) => {
        db.run('INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)', [key, value], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// 注册
app.post('/api/register', async (req, res) => {
    const { account, password } = req.body;
    if (!account || !password) return res.status(400).json({ error: '账号密码不能为空' });
    try {
        const row = await new Promise((resolve) => {
            db.get('SELECT id FROM users WHERE account = ?', [account], (err, row) => resolve(row));
        });
        if (row) return res.status(400).json({ error: '账号已存在' });
        const hashed = await bcrypt.hash(password, 10);
        await new Promise((resolve, reject) => {
            db.run('INSERT INTO users (account, password, register_time, records, result_history) VALUES (?, ?, ?, ?, ?)',
                [account, hashed, new Date().toISOString(), '[]', '[]'], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
        });
        res.json({ success: true, message: '注册成功' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '服务器错误' });
    }
});

// 登录
app.post('/api/login', (req, res) => {
    const { account, password } = req.body;
    if (!account || !password) return res.status(400).json({ error: '账号密码不能为空' });
    db.get('SELECT id, account, password, balance FROM users WHERE account = ?', [account], async (err, user) => {
        if (err || !user) return res.status(401).json({ error: '账号不存在' });
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: '密码错误' });
        const token = jwt.sign({ id: user.id, account: user.account }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, account: user.account, balance: user.balance });
    });
});

// 获取用户信息（从 token）
app.get('/api/user', (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: '未授权' });
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ error: 'token无效' });
        db.get('SELECT account, balance FROM users WHERE id = ?', [decoded.id], (err, row) => {
            if (err || !row) return res.status(404).json({ error: '用户不存在' });
            res.json(row);
        });
    });
});

// 充值申请（自动关联用户ID）
app.post('/api/recharge', (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: '未授权' });
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ error: 'token无效' });
        const { amount, tx_hash } = req.body;
        if (!amount || amount <= 0) return res.status(400).json({ error: '金额无效' });
        db.run('INSERT INTO pending_recharges (user_id, amount, tx_hash, created_at) VALUES (?, ?, ?, ?)',
            [decoded.id, amount, tx_hash || '', new Date().toISOString()], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, message: '充值申请已提交' });
            });
    });
});

// 提现申请
app.post('/api/withdraw', (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: '未授权' });
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ error: 'token无效' });
        const { amount, address } = req.body;
        if (!amount || amount <= 0 || !address) return res.status(400).json({ error: '参数错误' });
        db.get('SELECT balance FROM users WHERE id = ?', [decoded.id], (err, user) => {
            if (err || !user) return res.status(404).json({ error: '用户不存在' });
            if (user.balance < amount) return res.status(400).json({ error: '余额不足' });
            db.run('INSERT INTO withdraws (user_id, amount, address, created_at) VALUES (?, ?, ?, ?)',
                [decoded.id, amount, address, new Date().toISOString()], (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ success: true, message: '提现申请已提交' });
                });
        });
    });
});

// 游戏结算
app.post('/api/game/settle', (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: '未授权' });
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ error: 'token无效' });
        const { totalBet, winAmount } = req.body;
        if (totalBet === undefined || winAmount === undefined) return res.status(400).json({ error: '参数错误' });
        db.serialize(() => {
            db.get('BEGIN');
            db.get('SELECT balance FROM users WHERE id = ?', [decoded.id], (err, user) => {
                if (err || !user) { db.run('ROLLBACK'); return res.status(404).json({ error: '用户不存在' }); }
                if (user.balance < totalBet) { db.run('ROLLBACK'); return res.status(400).json({ error: '余额不足' }); }
                const newBalance = user.balance - totalBet + winAmount;
                db.run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, decoded.id], (err) => {
                    if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
                    getConfig('systemBankerBalance').then(bankerBalance => {
                        const bankerDelta = totalBet - winAmount;
                        setConfig('systemBankerBalance', bankerBalance + bankerDelta).then(() => {
                            db.run('COMMIT', () => {
                                res.json({ success: true, newBalance });
                            });
                        }).catch(e => { db.run('ROLLBACK'); res.status(500).json({ error: e.message }); });
                    }).catch(e => { db.run('ROLLBACK'); res.status(500).json({ error: e.message }); });
                });
            });
        });
    });
});

// 管理员登录（独立接口）
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '1d' });
        res.json({ success: true, token });
    } else {
        res.status(401).json({ error: '密码错误' });
    }
});

// 管理员中间件
function adminAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: '未授权' });
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err || decoded.role !== 'admin') return res.status(403).json({ error: '无权限' });
        next();
    });
}

// 获取待审核充值列表
app.get('/api/admin/recharge_orders', adminAuth, (req, res) => {
    db.all('SELECT * FROM pending_recharges WHERE status = "pending" ORDER BY id DESC', (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 审核通过充值
app.post('/api/admin/approve_recharge', adminAuth, (req, res) => {
    const { orderId } = req.body;
    db.serialize(() => {
        db.get('BEGIN');
        db.get('SELECT user_id, amount FROM pending_recharges WHERE id = ?', [orderId], (err, order) => {
            if (err || !order) { db.run('ROLLBACK'); return res.status(404).json({ error: '订单不存在' }); }
            db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [order.amount, order.user_id], (err) => {
                if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
                db.run('UPDATE pending_recharges SET status = "approved" WHERE id = ?', [orderId], (err) => {
                    if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
                    db.run('COMMIT', () => res.json({ success: true }));
                });
            });
        });
    });
});

// 拒绝充值
app.post('/api/admin/reject_recharge', adminAuth, (req, res) => {
    const { orderId } = req.body;
    db.run('UPDATE pending_recharges SET status = "rejected" WHERE id = ?', [orderId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// 获取提现订单
app.get('/api/admin/withdraw_orders', adminAuth, (req, res) => {
    db.all('SELECT * FROM withdraws WHERE status = "pending" ORDER BY id DESC', (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 审核通过提现
app.post('/api/admin/approve_withdraw', adminAuth, (req, res) => {
    const { orderId } = req.body;
    db.serialize(() => {
        db.get('BEGIN');
        db.get('SELECT user_id, amount FROM withdraws WHERE id = ?', [orderId], (err, order) => {
            if (err || !order) { db.run('ROLLBACK'); return res.status(404).json({ error: '订单不存在' }); }
            db.get('SELECT balance FROM users WHERE id = ?', [order.user_id], (err, user) => {
                if (err || !user) { db.run('ROLLBACK'); return res.status(404).json({ error: '用户不存在' }); }
                if (user.balance < order.amount) { db.run('ROLLBACK'); return res.status(400).json({ error: '用户余额不足' }); }
                db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [order.amount, order.user_id], (err) => {
                    if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
                    db.run('UPDATE withdraws SET status = "approved" WHERE id = ?', [orderId], (err) => {
                        if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
                        db.run('COMMIT', () => res.json({ success: true }));
                    });
                });
            });
        });
    });
});

// 拒绝提现
app.post('/api/admin/reject_withdraw', adminAuth, (req, res) => {
    const { orderId } = req.body;
    db.run('UPDATE withdraws SET status = "rejected" WHERE id = ?', [orderId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// 修改系统配置
app.post('/api/admin/config', adminAuth, async (req, res) => {
    const { banker_balance, adjust_factor } = req.body;
    try {
        if (banker_balance !== undefined) await setConfig('systemBankerBalance', banker_balance);
        if (adjust_factor !== undefined) await setConfig('adjustFactor', adjust_factor);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`✅ 后端运行在 http://localhost:${PORT}`);
});

==============================================================================================================================
  ==============================================================================================================================
  const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'game')));

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const RECHARGE_FILE = path.join(DATA_DIR, 'recharges.json');
const WITHDRAW_FILE = path.join(DATA_DIR, 'withdraws.json');

function readJSON(file, def = []) {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : def; } catch { return def; }
}
function writeJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8'); }

// 初始数据
if (!fs.existsSync(USERS_FILE)) {
  writeJSON(USERS_FILE, [
    { account: "admin", password: "admin888", balance: 0, vip: { level: 1, totalWager: 0, weeklyClaimed: null, upgradeRewards: [] }, records: [] }
  ]);
}
if (!fs.existsSync(CONFIG_FILE)) {
  writeJSON(CONFIG_FILE, { bankerBalance: 200000, adjustFactor: 0.98, probWeight: 50, serviceFee: 0.02 });
}
if (!fs.existsSync(RECHARGE_FILE)) writeJSON(RECHARGE_FILE, []);
if (!fs.existsSync(WITHDRAW_FILE)) writeJSON(WITHDRAW_FILE, []);

// VIP 配置
const VIP = [
  { lv:1, wager:0, reward:0, week:0 },
  { lv:2, wager:30000, reward:15, week:0 },
  { lv:3, wager:100000, reward:30, week:3 },
  { lv:4, wager:250000, reward:55, week:5 },
  { lv:5, wager:500000, reward:100, week:8 },
  { lv:6, wager:1000000, reward:200, week:15 },
  { lv:7, wager:2000000, reward:400, week:30 },
  { lv:8, wager:3000000, reward:550, week:55 },
  { lv:9, wager:4000000, reward:700, week:85 },
  { lv:10, wager:5000000, reward:800, week:110 }
];
function vipInfo(w) {
  let l = 1;
  for (let i = 1; i < VIP.length; i++) if (w >= VIP[i].wager) l = VIP[i].lv;
  return VIP.find(v => v.lv === l);
}

// 在线心跳
const onlineUsers = new Map();
setInterval(() => {
  const now = Date.now();
  for (let [k, t] of onlineUsers) if (now - t > 30000) onlineUsers.delete(k);
}, 10000);

// ========== 游戏状态 ==========
const pn = ["鱼", "虾", "蟹", "葫芦", "金钱", "鸡"];
const dc = [
  ["鱼", "虾"], ["鱼", "蟹"], ["鱼", "葫芦"], ["鱼", "金钱"], ["鱼", "鸡"],
  ["虾", "蟹"], ["虾", "葫芦"], ["虾", "金钱"], ["虾", "鸡"],
  ["蟹", "葫芦"], ["蟹", "金钱"], ["蟹", "鸡"],
  ["葫芦", "金钱"], ["葫芦", "鸡"], ["金钱", "鸡"]
];

let gameState = {
  round: 1,
  phase: 0,               // 0=下注(25s), 1=开奖(6s), 2=展示(4s)
  secondsRemaining: 25,
  results: [null, null, null],
  bets: {},               // { account: { single:{}, double:{}, totalBet:0 } }
  totalBets: 0,
  roundResult: {}
};
let gameHistory = [];
let paused = false;
let gameLock = false;      // 🔧 防止并发
// 庄家状态
let dealerState = {
  active: false,    // 当前局是否有庄家
  account: null,    // 庄家账号（完整）
  displayId: null,  // 庄家脱敏账号，如 13****05
  grabTime: null    // 抢庄时间戳
};
// 🔧 全局加权随机函数
let weightedPick = null;
function createWeightedPicker(probWeight) {
  const weights = pn.map((p) => {
    if (p === '鱼' || p === '虾' || p === '蟹') return probWeight;
    return 100 - probWeight;
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  return function() {
    let r = Math.random() * totalWeight;
    for (let i = 0; i < pn.length; i++) {
      r -= weights[i];
      if (r <= 0) return pn[i];
    }
    return pn[pn.length - 1];
  };
}
weightedPick = createWeightedPicker(50); // 初始化

function changePhase() {
  if (gameState.phase === 0) {
    // 开奖
    if (gameLock) return;
    gameLock = true;

    const cf = readJSON(CONFIG_FILE);
    const probWeight = cf.probWeight || 50;
    if (!weightedPick || probWeight !== cf.probWeight) {
      weightedPick = createWeightedPicker(probWeight);
    }
    const r1 = weightedPick();
    const r2 = weightedPick();
    const r3 = weightedPick();

    gameState.results = [r1, r2, r3];
    gameState.phase = 1;
    gameState.secondsRemaining = 6;
    settleRound(r1, r2, r3);
    gameLock = false;
  } else if (gameState.phase === 1) {
    gameState.phase = 2;
    gameState.secondsRemaining = 4;
  } else if (gameState.phase === 2) {
    gameState.round++;
    gameState.bets = {};
    gameState.totalBets = 0;
    gameState.roundResult = {};
    // 重置庄家状态，让下一局又可以抢庄
    dealerState.active = false;
    dealerState.account = null;
    dealerState.displayId = null;
    dealerState.grabTime = null;
    gameState.phase = 0;
    gameState.secondsRemaining = 25;
 }
}

function settleRound(r1, r2, r3) {
  const users = readJSON(USERS_FILE);
  const cf = readJSON(CONFIG_FILE);
  const adj = cf.adjustFactor || 0.98;
  const occurs = {};
  pn.forEach(p => occurs[p] = 0);
  [r1, r2, r3].forEach(p => occurs[p]++);

  let totalBetAmount = 0;
  let totalReturnAmount = 0;

  for (let acc in gameState.bets) {
    const ub = gameState.bets[acc];
    const user = users.find(u => u.account === acc);
    if (!user) continue;

    let totalReturn = 0;
    const winDetails = {};

    // 单选
    for (let p in ub.single) {
      const bet = ub.single[p];
      if (bet > 0 && occurs[p] > 0) {
        const ret = bet + bet * occurs[p] * adj;
        totalReturn += ret;
        winDetails[p] = ret;
      }
    }

    // 双押
    for (let key in ub.double) {
      const bet = ub.double[key];
      if (bet > 0) {
        const combo = key.split(',');
        if (occurs[combo[0]] > 0 && occurs[combo[1]] > 0) {
          let profit = bet * 5 * adj;
          const cs = new Set(combo);
          if ([r1, r2, r3].every(f => cs.has(f))) profit += bet * 2 * adj;
          const ret = bet + profit;
          totalReturn += ret;
          winDetails[key] = ret;
        }
      }
    }

    // 净增减余额
    const net = totalReturn - ub.totalBet;
    user.balance += net;

    // VIP 打码流水
    if (!user.vip) user.vip = { level: 1, totalWager: 0, weeklyClaimed: null, upgradeRewards: [] };
    user.vip.totalWager = (user.vip.totalWager || 0) + ub.totalBet;
    const info = vipInfo(user.vip.totalWager);
    if (info.lv > (user.vip.level || 1)) {
      const rewards = user.vip.upgradeRewards || [];
      for (let lv = (user.vip.level || 1) + 1; lv <= info.lv; lv++) {
        const cfg = VIP.find(v => v.lv === lv);
        if (cfg && cfg.reward > 0 && !rewards.includes(lv)) {
          user.balance += cfg.reward;
          rewards.push(lv);
        }
      }
      user.vip.level = info.lv;
      user.vip.upgradeRewards = rewards;
    }

    gameState.roundResult[acc] = { totalReturn, winDetails };
    totalBetAmount += ub.totalBet;
    totalReturnAmount += totalReturn;
  }

  // 庄家资金池
  cf.bankerBalance += totalBetAmount - totalReturnAmount;
  writeJSON(CONFIG_FILE, cf);
  writeJSON(USERS_FILE, users);

  gameHistory.push({ 
  round: gameState.round, 
  dealer: dealerState.active ? dealerState.displayId : null,
  dice: `${r1},${r2},${r3}`, 
  time: new Date().toLocaleTimeString() 
});
  if (gameHistory.length > 100) gameHistory.shift();
}

// 计时器
setInterval(() => {
  if (paused) return;
  if (gameState.secondsRemaining > 0) gameState.secondsRemaining--;
  if (gameState.secondsRemaining <= 0) changePhase();
}, 1000);

// ===================== API 路由 =====================
// 抢庄
app.post('/api/game/grab-dealer', (req, res) => {
  const { account } = req.body;
  if (!account) return res.status(400).json({ msg: '缺少账号' });
  
  // 只有下注阶段才能抢庄
  if (gameState.phase !== 0) return res.status(400).json({ msg: '当前不是下注阶段' });
  
  // 如果本局已有庄家，不能再抢
  if (dealerState.active) return res.status(400).json({ msg: '本局已有庄家' });

  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.account === account);
  if (!user) return res.status(400).json({ msg: '用户不存在' });
  if (user.balance < 2000) return res.status(400).json({ msg: '余额不足，需要2000 USDT抢庄' });

  // 扣款
  user.balance -= 2000;
  
  // 2% 服务费
  const cf = readJSON(CONFIG_FILE);
  const serviceFee = Math.round(2000 * (cf.serviceFee || 0.02) * 100) / 100;
  cf.bankerBalance += serviceFee;
  writeJSON(CONFIG_FILE, cf);
  
  // 保存用户数据
  const idx = users.findIndex(u => u.account === account);
  if (idx !== -1) users[idx] = user;
  writeJSON(USERS_FILE, users);
  
  // 设置庄家信息
  dealerState.active = true;
  dealerState.account = account;
  dealerState.displayId = account.substring(0, 2) + '****' + account.substring(account.length - 2);
  dealerState.grabTime = Date.now();

  // 记录日志（可选，方便后台查询）
  console.log(`[庄家] ${dealerState.displayId} 抢庄成功，扣除2000 USDT`);

  res.json({ 
    msg: '抢庄成功', 
    balance: user.balance,
    dealer: {
      displayId: dealerState.displayId,
      time: new Date(dealerState.grabTime).toLocaleTimeString()
    }
  });
});
// ---------- 认证 ----------
app.post('/api/login', (req, res) => {
  const { account, password } = req.body;
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.account === account);
  if (!user) return res.status(400).json({ msg: '账号不存在' });
  if (user.password !== password) return res.status(400).json({ msg: '密码错误' });
  if (!user.vip) user.vip = { level: 1, totalWager: 0, weeklyClaimed: null, upgradeRewards: [] };
  res.json({ success: true, user: { account: user.account, balance: user.balance, vip: user.vip } });
});

app.post('/api/register', (req, res) => {
  const { account, password, referralCode } = req.body;
  const validCodes = ["VIP666", "888VIP", "GOLD2025", "LUCKY8", "DICE100"];
  if (!validCodes.includes(referralCode)) return res.status(400).json({ msg: '推荐码无效' });
  const users = readJSON(USERS_FILE);
  if (users.find(u => u.account === account)) return res.status(400).json({ msg: '账号已存在' });
  const newUser = {
    account,
    password,
    balance: 0,
    vip: { level: 1, totalWager: 0, weeklyClaimed: null, upgradeRewards: [] },
    records: []
  };
  users.push(newUser);
  writeJSON(USERS_FILE, users);
  res.json({ success: true, user: { account: newUser.account, balance: newUser.balance, vip: newUser.vip } });
});

// ---------- 游戏状态 ----------
app.get('/api/ping', (req, res) => res.json({ ok: true }));

app.get('/api/game/state', (req, res) => {
  const acc = req.query.account || '';
  res.json({
    round: gameState.round,
    phase: gameState.phase,
    secondsRemaining: gameState.secondsRemaining,
    results: gameState.results,
    totalPlayers: Object.keys(gameState.bets).length,
    totalBets: gameState.totalBets,
    dealer: dealerState.active ? dealerState.displayId : null,
    myBets: gameState.bets[acc] || null,
    myResult: gameState.roundResult[acc] || null,
    online: onlineUsers.size,
    paused
  });
});

app.post('/api/game/bet', (req, res) => {
  if (gameLock) return res.status(400).json({ msg: '正在开奖，请稍候' });
  const { account, single, double } = req.body;
  if (!account) return res.status(400).json({ msg: '缺少账号' });
  if (gameState.phase !== 0) return res.status(400).json({ msg: '已截止下注' });

  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.account === account);
  if (!user) return res.status(400).json({ msg: '用户不存在' });

  let betAmount = 0;
  if (single) for (let p in single) betAmount += single[p];
  if (double) for (let k in double) betAmount += double[k];

  if (betAmount <= 0) return res.status(400).json({ msg: '无效投注' });
  if (user.balance < betAmount) return res.status(400).json({ msg: '余额不足' });

  // 扣减余额
  user.balance -= betAmount;
  writeJSON(USERS_FILE, users);

  if (!gameState.bets[account]) gameState.bets[account] = { single: {}, double: {}, totalBet: 0 };
  const my = gameState.bets[account];
  if (single) for (let p in single) my.single[p] = (my.single[p] || 0) + single[p];
  if (double) for (let k in double) my.double[k] = (my.double[k] || 0) + double[k];
  my.totalBet += betAmount;
  gameState.totalBets += betAmount;

  res.json({ msg: '投注成功', totalBet: my.totalBet, balance: user.balance });
});

app.get('/api/game/history', (req, res) => res.json({ list: gameHistory }));

// ---------- 用户管理 ----------
app.get('/api/users', (req, res) => {
  const users = readJSON(USERS_FILE);
  res.json(users.map(u => ({ account: u.account, balance: u.balance, vip: u.vip, records: u.records })));
});

app.put('/api/user/:account/balance', (req, res) => {
  const users = readJSON(USERS_FILE);
  const u = users.find(u => u.account === req.params.account);
  if (!u) return res.status(404).json({ msg: '用户不存在' });
  u.balance = req.body.balance;
  writeJSON(USERS_FILE, users);
  res.json({ msg: 'ok' });
});

app.put('/api/user/:account/vipdata', (req, res) => {
  const users = readJSON(USERS_FILE);
  const u = users.find(u => u.account === req.params.account);
  if (!u) return res.status(404).json({ msg: '用户不存在' });
  if (!u.vip) u.vip = { level: 1, totalWager: 0, weeklyClaimed: null, upgradeRewards: [] };
  if (req.body.betPoints !== undefined) {
    u.vip.totalWager = req.body.betPoints;
    const info = vipInfo(u.vip.totalWager);
    const rewards = u.vip.upgradeRewards || [];
    for (let lv = (u.vip.level || 1) + 1; lv <= info.lv; lv++) {
      const cfg = VIP.find(v => v.lv === lv);
      if (cfg && cfg.reward > 0 && !rewards.includes(lv)) {
        u.balance += cfg.reward;
        rewards.push(lv);
      }
    }
    u.vip.level = info.lv;
    u.vip.upgradeRewards = rewards;
  }
  writeJSON(USERS_FILE, users);
  res.json({ msg: 'ok' });
});

app.post('/api/user/:account/vip/weekly', (req, res) => {
  const users = readJSON(USERS_FILE);
  const u = users.find(u => u.account === req.params.account);
  if (!u) return res.status(404).json({ msg: '用户不存在' });
  if (!u.vip) u.vip = { level: 1, totalWager: 0, weeklyClaimed: null, upgradeRewards: [] };
  const cfg = vipInfo(u.vip.totalWager || 0);
  if (cfg.week <= 0) return res.status(400).json({ msg: '无周工资' });
  const now = new Date();
  const last = u.vip.weeklyClaimed ? new Date(u.vip.weeklyClaimed) : null;
  if (last && (now - last) / 86400000 < 7) return res.status(400).json({ msg: '本周已领' });
  u.balance += cfg.week;
  u.vip.weeklyClaimed = now.toISOString();
  writeJSON(USERS_FILE, users);
  res.json({ msg: `领取成功 ${cfg.week} USDT`, balance: u.balance });
});

// ---------- 系统配置 ----------
app.get('/api/config', (req, res) => res.json(readJSON(CONFIG_FILE)));
app.put('/api/config', (req, res) => {
  writeJSON(CONFIG_FILE, { ...readJSON(CONFIG_FILE), ...req.body });
  res.json({ msg: 'ok' });
});

// ---------- 充提 ----------
app.post('/api/recharge', (req, res) => {
  const recharges = readJSON(RECHARGE_FILE);
  recharges.push({ id: Date.now(), account: req.body.account, amount: req.body.amount, status: 'pending' });
  writeJSON(RECHARGE_FILE, recharges);
  res.json({ msg: '已提交' });
});

app.put('/api/recharge/:id', (req, res) => {
  const recharges = readJSON(RECHARGE_FILE);
  const o = recharges.find(o => o.id === Number(req.params.id));
  if (!o) return res.status(404).json({ msg: '不存在' });
  if (req.body.status === 'approved' && o.status !== 'approved') {
    const users = readJSON(USERS_FILE);
    const u = users.find(u => u.account === o.account);
    if (u) { u.balance += o.amount; writeJSON(USERS_FILE, users); }
  }
  o.status = req.body.status;
  writeJSON(RECHARGE_FILE, recharges);  // 🔧 修复：写回文件
  res.json({ msg: 'ok' });
});

app.post('/api/withdraw', (req, res) => {
  const withdraws = readJSON(WITHDRAW_FILE);
  withdraws.push({ id: Date.now(), account: req.body.account, amount: req.body.amount, address: req.body.address, status: 'pending' });
  writeJSON(WITHDRAW_FILE, withdraws);
  res.json({ msg: '已提交' });
});

// 如果需要提现审核接口，可以再加一个 put /api/withdraw/:id

// ---------- 心跳 ----------
app.post('/api/heartbeat', (req, res) => {
  onlineUsers.set(req.body.account, Date.now());
  res.json({ online: onlineUsers.size });
});
app.get('/api/online', (req, res) => res.json({ count: onlineUsers.size }));

// 所有其他请求返回 index.html
app.use((req, res) => res.sendFile(path.join(__dirname, 'game', 'index.html')));
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`✅ 服务器启动成功，端口：${PORT}`));
