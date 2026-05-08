const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

const db = new sqlite3.Database('./game.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        phone TEXT PRIMARY KEY,
        password TEXT NOT NULL,
        balance REAL DEFAULT 1000,
        referral_code TEXT,
        register_time TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS valid_referral_codes (
        code TEXT PRIMARY KEY
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS system_banker (
        id INTEGER PRIMARY KEY,
        balance REAL DEFAULT 100000
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS online_count (
        count INTEGER DEFAULT 0
    )`);
    db.get(`SELECT * FROM system_banker WHERE id=1`, (err, row) => {
        if (!row) db.run(`INSERT INTO system_banker (id, balance) VALUES (1, 100000)`);
    });
    const defaultCodes = ['VIP888', 'ABC123', 'GAME2024', 'TEST001'];
    defaultCodes.forEach(code => {
        db.run(`INSERT OR IGNORE INTO valid_referral_codes (code) VALUES (?)`, [code]);
    });
});

let onlineSet = new Set();
wss.on('connection', (ws) => {
    onlineSet.add(ws);
    updateOnlineCount();
    ws.on('close', () => {
        onlineSet.delete(ws);
        updateOnlineCount();
    });
});
function updateOnlineCount() {
    const count = onlineSet.size;
    db.run(`UPDATE online_count SET count = ?`, [count]);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'online', count }));
        }
    });
}

app.get('/getOnlineCount', (req, res) => {
    db.get(`SELECT count FROM online_count`, (err, row) => {
        res.json({ count: row ? row.count : 0 });
    });
});

app.post('/register', (req, res) => {
    const { phone, password, referralCode } = req.body;
    if (!phone || !password || !referralCode) return res.status(400).json({ error: '缺少字段' });
    db.get(`SELECT * FROM valid_referral_codes WHERE code = ?`, [referralCode], (err, row) => {
        if (!row) return res.status(400).json({ error: '推荐码无效' });
        db.get(`SELECT * FROM users WHERE phone = ?`, [phone], (err, user) => {
            if (user) return res.status(400).json({ error: '手机号已注册' });
            db.run(`INSERT INTO users (phone, password, balance, referral_code, register_time) VALUES (?, ?, 1000, ?, ?)`,
                [phone, password, referralCode, new Date().toISOString()], (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ success: true });
                });
        });
    });
});

app.post('/login', (req, res) => {
    const { phone, password } = req.body;
    db.get(`SELECT * FROM users WHERE phone = ? AND password = ?`, [phone, password], (err, user) => {
        if (!user) return res.status(401).json({ error: '账号或密码错误' });
        res.json({ phone: user.phone, balance: user.balance, referralCode: user.referral_code });
    });
});

app.get('/user/:phone', (req, res) => {
    db.get(`SELECT balance FROM users WHERE phone = ?`, [req.params.phone], (err, row) => {
        res.json({ balance: row ? row.balance : 0 });
    });
});

app.post('/user/balance', (req, res) => {
    const { phone, delta } = req.body;
    db.run(`UPDATE users SET balance = balance + ? WHERE phone = ?`, [delta, phone], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        db.get(`SELECT balance FROM users WHERE phone = ?`, [phone], (err, row) => {
            res.json({ balance: row.balance });
        });
    });
});

app.get('/banker', (req, res) => {
    db.get(`SELECT balance FROM system_banker WHERE id=1`, (err, row) => {
        res.json({ balance: row ? row.balance : 100000 });
    });
});

app.post('/banker', (req, res) => {
    const { delta } = req.body;
    db.run(`UPDATE system_banker SET balance = balance + ? WHERE id=1`, [delta], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        db.get(`SELECT balance FROM system_banker WHERE id=1`, (err, row) => {
            res.json({ balance: row.balance });
        });
    });
});

app.get('/admin/users', (req, res) => {
    db.all(`SELECT phone, balance, referral_code, register_time FROM users`, (err, rows) => {
        res.json(rows);
    });
});

app.post('/admin/user/balance', (req, res) => {
    const { phone, newBalance } = req.body;
    db.run(`UPDATE users SET balance = ? WHERE phone = ?`, [newBalance, phone], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.get('/admin/referral-codes', (req, res) => {
    db.all(`SELECT code FROM valid_referral_codes`, (err, rows) => {
        res.json(rows.map(r => r.code));
    });
});

app.post('/admin/referral-codes', (req, res) => {
    const { code } = req.body;
    db.run(`INSERT OR IGNORE INTO valid_referral_codes (code) VALUES (?)`, [code], (err) => {
        res.json({ success: !err });
    });
});

app.post('/admin/banker', (req, res) => {
    const { balance } = req.body;
    db.run(`UPDATE system_banker SET balance = ? WHERE id=1`, [balance], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

const PORT = 8090;
server.listen(PORT, () => {
    console.log(`后端服务运行在 http://localhost:${PORT}`);
});



============================================================================================================================================
    ============================================================================================================================================
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
let gameLock = false;
function changePhase() {
  if (gameState.phase === 0) {
    // 开奖
    const cf = readJSON(CONFIG_FILE);
const probWeight = cf.probWeight || 50;  // 50正常，高于50庄家有利，低于50玩家有利
const weights = pn.map((p, i) => {
    // 鱼虾蟹权重高（玩家常押），金钱鸡葫芦权重低（庄家安全面）
    if (p === '鱼' || p === '虾' || p === '蟹') return probWeight;
    return 100 - probWeight;
});
const totalWeight = weights.reduce((a, b) => a + b, 0);
function weightedPick() {
    let r = Math.random() * totalWeight;
    for (let i = 0; i < pn.length; i++) {
        r -= weights[i];
        if (r <= 0) return pn[i];
    }
    return pn[pn.length - 1];
}
const r1 = weightedPick();
const r2 = weightedPick();
const r3 = weightedPick();
    gameState.results = [r1, r2, r3];
    gameState.phase = 1;
    gameState.secondsRemaining = 6;
    settleRound(r1, r2, r3);
  } else if (gameState.phase === 1) {
    gameState.phase = 2;
    gameState.secondsRemaining = 4;
  } else if (gameState.phase === 2) {
    gameState.round++;
    gameState.bets = {};
    gameState.totalBets = 0;
    gameState.roundResult = {};
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

    // 🔧 修复：净增减余额 = 中奖金额 - 投注本金
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

  // 庄家资金池（总收入 - 总赔付）
  cf.bankerBalance += totalBetAmount - totalReturnAmount;
  writeJSON(CONFIG_FILE, cf);
  writeJSON(USERS_FILE, users);

  gameHistory.push({ round: gameState.round, dice: `${r1},${r2},${r3}`, time: new Date().toLocaleTimeString() });
  if (gameHistory.length > 100) gameHistory.shift();
}

// 计时器
setInterval(() => {
  if (paused) return;
  if (gameState.secondsRemaining > 0) gameState.secondsRemaining--;
  if (gameState.secondsRemaining <= 0) changePhase();
}, 1000);

// ===================== API 路由 =====================

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
    myBets: gameState.bets[acc] || null,
    myResult: gameState.roundResult[acc] || null,
    online: onlineUsers.size,
    paused
  });
});

app.post('/api/game/bet', (req, res) => {
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
  if (single) {
    for (let p in single) {
      my.single[p] = (my.single[p] || 0) + single[p];
    }
  }
  if (double) {
    for (let k in double) {
      my.double[k] = (my.double[k] || 0) + double[k];
    }
  }
  my.totalBet += betAmount;
  gameState.totalBets += betAmount;

  res.json({ msg: '投注成功', totalBet: my.totalBet, balance: user.balance });
});

app.get('/api/game/history', (req, res) => res.json({ list: gameHistory }));

// ---------- 用户管理 ----------
app.get('/api/users', (req, res) => {
  // 只返回非敏感信息（不包含密码）
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
  writeJSON(RECHARGE_FILE, recharges);
  res.json({ msg: 'ok' });
});

app.post('/api/withdraw', (req, res) => {
  const withdraws = readJSON(WITHDRAW_FILE);
  withdraws.push({ id: Date.now(), account: req.body.account, amount: req.body.amount, address: req.body.address, status: 'pending' });
  writeJSON(WITHDRAW_FILE, withdraws);
  res.json({ msg: '已提交' });
});

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
