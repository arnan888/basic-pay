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
let gameLock = false;      // 防止并发
// 庄家状态
let dealerState = {
  active: false,    // 当前局是否有庄家
  account: null,    // 庄家账号（完整）
  displayId: null,  // 庄家脱敏账号，如 13****05
  grabTime: null    // 抢庄时间戳
};
// 全局加权随机函数
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

  // 庄家返利
  let dealerProfitAmount = 0;
  if (dealerState.active && dealerState.account) {
      const dealerUser = users.find(u => u.account === dealerState.account);
      if (dealerUser) {
          dealerProfitAmount = totalBetAmount * 0.95 - totalReturnAmount;
          dealerUser.balance += dealerProfitAmount;
          
          // 添加庄家收益记录
          if (!dealerUser.records) dealerUser.records = [];
          dealerUser.records.push({
            type: 'dealer_profit',
            amount: dealerProfitAmount,
            balance: dealerUser.balance,
            time: new Date().toISOString(),
            description: `第${gameState.round}局庄家收益`
          });
      }
  }
  // 存到历史记录里
  gameState.dealerProfit = dealerProfitAmount;

  // 庄家资金池
  cf.bankerBalance += totalBetAmount - totalReturnAmount;
  writeJSON(CONFIG_FILE, cf);
  writeJSON(USERS_FILE, users);

  gameHistory.push({
    round: gameState.round, 
    dealer: dealerState.active ? dealerState.displayId : null, 
    dice: `${r1},${r2},${r3}`, 
    time: new Date().toLocaleTimeString(),
    bets: JSON.parse(JSON.stringify(gameState.bets)),
    roundResult: JSON.parse(JSON.stringify(gameState.roundResult)),
    dealerProfit: gameState.dealerProfit || 0
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
// 抢庄记录文件
const DEALER_FILE = path.join(DATA_DIR, 'dealer_records.json');
if (!fs.existsSync(DEALER_FILE)) writeJSON(DEALER_FILE, []);

// 修改后的抢庄接口
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
  
  // 添加交易记录到用户
  if (!user.records) user.records = [];
  user.records.push({
    type: 'dealer_grab',
    amount: -2000,
    balance: user.balance,
    time: new Date().toISOString(),
    description: '抢庄扣款'
  });
  
  // 保存用户数据
  const idx = users.findIndex(u => u.account === account);
  if (idx !== -1) users[idx] = user;
  writeJSON(USERS_FILE, users);
  
  // 保存抢庄记录到文件
  const dealerRecords = readJSON(DEALER_FILE);
  dealerRecords.push({
    round: gameState.round,
    account: account,
    displayId: account.substring(0, 2) + '****' + account.substring(account.length - 2),
    amount: 2000,
    serviceFee: serviceFee,
    time: new Date().toISOString(),
    timestamp: Date.now()
  });
  
  // 只保留最近100条
  if (dealerRecords.length > 100) dealerRecords.shift();
  writeJSON(DEALER_FILE, dealerRecords);
  
  // 设置庄家信息
  dealerState.active = true;
  dealerState.account = account;
  dealerState.displayId = account.substring(0, 2) + '****' + account.substring(account.length - 2);
  dealerState.grabTime = Date.now();

  console.log(`[庄家] ${dealerState.displayId} 抢庄成功，扣除2000 USDT，服务费${serviceFee}`);

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
app.get('/api/user/:account/game-records', (req, res) => {
  const account = req.params.account;
  const records = gameHistory
    .filter(h => h.bets && h.bets[account])
    .slice(-100)
    .map(h => ({
      round: h.round,
      dealer: h.dealer || '无庄',
      dice: h.dice,
      time: h.time,
      bet: h.bets[account] ? h.bets[account].totalBet || 0 : 0,
      return: h.roundResult && h.roundResult[account] ? h.roundResult[account].totalReturn || 0 : 0
    }));
  res.json({ account, records });
});
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
  writeJSON(RECHARGE_FILE, recharges);
  res.json({ msg: 'ok' });
});

app.post('/api/withdraw', (req, res) => {
  const withdraws = readJSON(WITHDRAW_FILE);
  withdraws.push({ id: Date.now(), account: req.body.account, amount: req.body.amount, address: req.body.address, status: 'pending' });
  writeJSON(WITHDRAW_FILE, withdraws);
  res.json({ msg: '已提交' });
});

// ===================== 后台管理专用接口 =====================
const ADMIN_PASSWORD = 'wang......'; // 与 admin.html 保持一致

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true, token: 'admin_token_' + Date.now() });
  } else {
    res.status(401).json({ msg: '密码错误' });
  }
});

function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token && token.startsWith('admin_token_')) {
    next();
  } else {
    res.status(401).json({ msg: '未授权' });
  }
}

app.get('/api/recharges/pending', adminAuth, (req, res) => {
  const recharges = readJSON(RECHARGE_FILE);
  res.json(recharges);
});

app.get('/api/withdraws/pending', adminAuth, (req, res) => {
  const withdraws = readJSON(WITHDRAW_FILE);
  res.json(withdraws);
});

app.put('/api/withdraw/:id', adminAuth, (req, res) => {
  const withdraws = readJSON(WITHDRAW_FILE);
  const o = withdraws.find(o => o.id === Number(req.params.id));
  if (!o) return res.status(404).json({ msg: '不存在' });
  
  if (req.body.status === 'approved' && o.status !== 'approved') {
    const users = readJSON(USERS_FILE);
    const u = users.find(u => u.account === o.account);
    if (u) {
      if (u.balance < o.amount) {
        return res.status(400).json({ msg: '余额不足' });
      }
      u.balance -= o.amount;
      writeJSON(USERS_FILE, users);
    }
  }
  o.status = req.body.status;
  writeJSON(WITHDRAW_FILE, withdraws);
  res.json({ msg: 'ok' });
});

app.post('/api/game/next', adminAuth, (req, res) => {
  changePhase();
  res.json({ msg: '已跳转下一阶段' });
});

app.post('/api/game/pause', adminAuth, (req, res) => {
  paused = true;
  res.json({ msg: '游戏已暂停' });
});

app.post('/api/game/resume', adminAuth, (req, res) => {
  paused = false;
  res.json({ msg: '游戏已恢复' });
});

app.post('/api/game/reset', adminAuth, (req, res) => {
  gameState = {
    round: 1,
    phase: 0,
    secondsRemaining: 25,
    results: [null, null, null],
    bets: {},
    totalBets: 0,
    roundResult: {}
  };
  dealerState = {
    active: false,
    account: null,
    displayId: null,
    grabTime: null
  };
  gameHistory = [];
  paused = false;
  res.json({ msg: '游戏已重置' });
});

app.get('/api/admin/dealer-records', adminAuth, (req, res) => {
  const dealerRecords = gameHistory
    .filter(h => h.dealer)
    .map(h => ({
      round: h.round,
      dealer: h.dealer,
      dice: h.dice,
      time: h.time,
      profit: h.dealerProfit || 0
    }));
  res.json({ records: dealerRecords });
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





