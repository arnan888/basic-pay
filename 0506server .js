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
const DEALER_FILE = path.join(DATA_DIR, 'dealer_records.json');

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
if (!fs.existsSync(DEALER_FILE)) writeJSON(DEALER_FILE, []);

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

// 在线心跳（改用设备ID）
const onlineUsers = new Map();
setInterval(() => {
  const now = Date.now();
  for (let [k, t] of onlineUsers) if (now - t > 90000) onlineUsers.delete(k);
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
  bets: {},
  totalBets: 0,
  roundResult: {}
};
let gameHistory = [];
let paused = false;
let gameLock = false;
let dealerState = {
  active: false,
  account: null,
  displayId: null,
  grabTime: null
};
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
weightedPick = createWeightedPicker(50);

function changePhase() {
  if (gameState.phase === 0) {
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

    const net = totalReturn - ub.totalBet;
    user.balance += net;

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

  // ========== 庄家返利（只抽净盈利，返还本金2000）==========
  let dealerProfitAmount = 0;
  if (dealerState.active && dealerState.account) {
    const dealerUser = users.find(u => u.account === dealerState.account);
    if (dealerUser) {
      const grossProfit = totalBetAmount - totalReturnAmount;
      let serviceFee = 0;
      if (grossProfit > 0) {
        serviceFee = grossProfit * (cf.serviceFee || 0.02);
        cf.bankerBalance += serviceFee;
      }
      const netProfit = grossProfit - serviceFee;
      dealerUser.balance += netProfit;
      dealerUser.balance += 2000;   // 返还本金

      if (!dealerUser.records) dealerUser.records = [];
      dealerUser.records.push({
        type: 'dealer_settle',
        amount: netProfit + 2000,
        balance: dealerUser.balance,
        time: new Date().toISOString(),
        description: `第${gameState.round}局结算 (返本金2000, 净盈利${netProfit.toFixed(2)})`
      });
      dealerProfitAmount = netProfit;
    }
  }
  gameState.dealerProfit = dealerProfitAmount;

  // 保存数据
  writeJSON(CONFIG_FILE, cf);
  writeJSON(USERS_FILE, users);

  gameHistory.push({
    round: gameState.round,
    dealer: dealerState.active ? dealerState.displayId : null,
    dice: `${r1},${r2},${r3}`,
    time: new Date().toLocaleTimeString(),
    bets: JSON.parse(JSON.stringify(gameState.bets)),
    roundResult: JSON.parse(JSON.stringify(gameState.roundResult)),
    dealerProfit: dealerProfitAmount
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
  if (gameState.phase !== 0) return res.status(400).json({ msg: '当前不是下注阶段' });
  if (dealerState.active) return res.status(400).json({ msg: '本局已有庄家' });

  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.account === account);
  if (!user) return res.status(400).json({ msg: '用户不存在' });
  if (user.balance < 2000) return res.status(400).json({ msg: '余额不足，需要2000 USDT抢庄' });

  // 冻结本金
  user.balance -= 2000;
  // 服务费在结算时抽取，这里不再扣除
  if (!user.records) user.records = [];
  user.records.push({
    type: 'dealer_grab',
    amount: -2000,
    balance: user.balance,
    time: new Date().toISOString(),
    description: '抢庄冻结本金'
  });

  const idx = users.findIndex(u => u.account === account);
  if (idx !== -1) users[idx] = user;
  writeJSON(USERS_FILE, users);

  // 记录抢庄事件
  const dealerRecords = readJSON(DEALER_FILE);
  dealerRecords.push({
    round: gameState.round,
    account: account,
    displayId: account.substring(0, 2) + '****' + account.substring(account.length - 2),
    amount: 2000,
    serviceFee: 0, // 实际服务费结算时计算
    time: new Date().toISOString(),
    timestamp: Date.now()
  });
  if (dealerRecords.length > 100) dealerRecords.shift();
  writeJSON(DEALER_FILE, dealerRecords);

  dealerState.active = true;
  dealerState.account = account;
  dealerState.displayId = account.substring(0, 2) + '****' + account.substring(account.length - 2);
  dealerState.grabTime = Date.now();

  // 生成全局投注汇总
  const betSummary = {
    single: {},
    double: {},
    totalPlayers: Object.keys(gameState.bets).length,
    totalBets: gameState.totalBets
  };
  pn.forEach(p => betSummary.single[p] = 0);
  dc.forEach(c => betSummary.double[c.join(',')] = 0);
  for (let acc in gameState.bets) {
    const ub = gameState.bets[acc];
    for (let p in ub.single) betSummary.single[p] += ub.single[p];
    for (let key in ub.double) betSummary.double[key] += ub.double[key];
  }

  console.log(`[庄家] ${dealerState.displayId} 抢庄成功，冻结2000 USDT`);

  res.json({
    msg: '抢庄成功',
    balance: user.balance,
    dealer: { displayId: dealerState.displayId, time: new Date(dealerState.grabTime).toLocaleTimeString() },
    betSummary: betSummary
  });
});

// 认证
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
    account, password, balance: 0,
    vip: { level: 1, totalWager: 0, weeklyClaimed: null, upgradeRewards: [] },
    records: []
  };
  users.push(newUser);
  writeJSON(USERS_FILE, users);
  res.json({ success: true, user: { account: newUser.account, balance: newUser.balance, vip: newUser.vip } });
});

// 游戏状态
app.get('/api/ping', (req, res) => res.json({ ok: true }));

app.get('/api/game/state', (req, res) => {
  const acc = req.query.account || '';
  let betSummary = null;
  // 庄家获取全局投注
  if (dealerState.active && acc === dealerState.account) {
    betSummary = { single: {}, double: {}, totalPlayers: Object.keys(gameState.bets).length, totalBets: gameState.totalBets };
    pn.forEach(p => betSummary.single[p] = 0);
    dc.forEach(c => betSummary.double[c.join(',')] = 0);
    for (let a in gameState.bets) {
      const ub = gameState.bets[a];
      for (let p in ub.single) betSummary.single[p] = (betSummary.single[p] || 0) + ub.single[p];
      for (let k in ub.double) betSummary.double[k] = (betSummary.double[k] || 0) + ub.double[k];
    }
  }
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
    paused,
    betSummary: betSummary
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

// 用户管理
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
      return: h.roundResult && h.roundResult[account] ? h.roundResult[account].totalReturn || 0 : 0,
      dealerProfit: h.dealerProfit || 0
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

// 系统配置
app.get('/api/config', (req, res) => res.json(readJSON(CONFIG_FILE)));
app.put('/api/config', (req, res) => {
  writeJSON(CONFIG_FILE, { ...readJSON(CONFIG_FILE), ...req.body });
  res.json({ msg: 'ok' });
});

// 充值
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

// 提现
app.post('/api/withdraw', (req, res) => {
  const withdraws = readJSON(WITHDRAW_FILE);
  withdraws.push({ id: Date.now(), account: req.body.account, amount: req.body.amount, address: req.body.address, status: 'pending' });
  writeJSON(WITHDRAW_FILE, withdraws);
  res.json({ msg: '已提交' });
});

app.put('/api/withdraw/:id', (req, res) => {
  const withdraws = readJSON(WITHDRAW_FILE);
  const o = withdraws.find(o => o.id === Number(req.params.id));
  if (!o) return res.status(404).json({ msg: '不存在' });
  if (req.body.status === 'approved' && o.status !== 'approved') {
    const users = readJSON(USERS_FILE);
    const u = users.find(u => u.account === o.account);
    if (u) {
      if (u.balance < o.amount) return res.status(400).json({ msg: '余额不足' });
      u.balance -= o.amount;
      writeJSON(USERS_FILE, users);
    }
  }
  o.status = req.body.status;
  writeJSON(WITHDRAW_FILE, withdraws);
  res.json({ msg: 'ok' });
});

// 后台管理接口（无需token）
app.get('/api/recharges/pending', (req, res) => res.json(readJSON(RECHARGE_FILE)));
app.get('/api/withdraws/pending', (req, res) => res.json(readJSON(WITHDRAW_FILE)));

app.post('/api/game/next', (req, res) => { changePhase(); res.json({ msg: '已跳转下一阶段' }); });
app.post('/api/game/pause', (req, res) => { paused = true; res.json({ msg: '游戏已暂停' }); });
app.post('/api/game/resume', (req, res) => { paused = false; res.json({ msg: '游戏已恢复' }); });
app.post('/api/game/reset', (req, res) => {
  gameState = { round: 1, phase: 0, secondsRemaining: 25, results: [null, null, null], bets: {}, totalBets: 0, roundResult: {} };
  dealerState = { active: false, account: null, displayId: null, grabTime: null };
  gameHistory = [];
  paused = false;
  res.json({ msg: '游戏已重置' });
});

app.get('/api/admin/dealer-records', (req, res) => {
  const records = gameHistory.filter(h => h.dealer).map(h => ({
    round: h.round, dealer: h.dealer, dice: h.dice, time: h.time, profit: h.dealerProfit || 0
  }));
  res.json({ records });
});

// 心跳（使用设备deviceId）
app.post('/api/heartbeat', (req, res) => {
  const { deviceId } = req.body;
  if (deviceId) onlineUsers.set(deviceId, Date.now());
  res.json({ online: onlineUsers.size });
});
app.get('/api/online', (req, res) => res.json({ count: onlineUsers.size }));

// 所有其他请求返回 index.html
app.use((req, res) => res.sendFile(path.join(__dirname, 'game', 'index.html')));
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`✅ 服务器启动成功，端口：${PORT}`));