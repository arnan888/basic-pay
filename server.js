const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'game')));

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const RECHARGE_FILE = path.join(DATA_DIR, 'recharges.json');
const WITHDRAW_FILE = path.join(DATA_DIR, 'withdraws.json');
const HISTORY_FILE = path.join(DATA_DIR, 'game_history.json');

function readJSON(file, def = []) {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : def; } catch { return def; }
}
function writeJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8'); }

if (!fs.existsSync(USERS_FILE)) writeJSON(USERS_FILE, [
  { account: "admin", password: "admin888", balance: 0, phone: "", email: "", vip: { level: 1, totalWager: 0, weeklyClaimed: null, upgradeRewards: [] }, records: [] }
]);
if (!fs.existsSync(CONFIG_FILE)) writeJSON(CONFIG_FILE, { bankerBalance: 200000, adjustFactor: 0.98, probWeight: 50, serviceFee: 0.02 });
if (!fs.existsSync(RECHARGE_FILE)) writeJSON(RECHARGE_FILE, []);
if (!fs.existsSync(WITHDRAW_FILE)) writeJSON(WITHDRAW_FILE, []);
if (!fs.existsSync(HISTORY_FILE)) writeJSON(HISTORY_FILE, []);

const VIP = [
  { lv:1, wager:0, reward:0, week:0 },{ lv:2, wager:30000, reward:15, week:0 },{ lv:3, wager:100000, reward:30, week:3 },
  { lv:4, wager:250000, reward:55, week:5 },{ lv:5, wager:500000, reward:100, week:8 },{ lv:6, wager:1000000, reward:200, week:15 },
  { lv:7, wager:2000000, reward:400, week:30 },{ lv:8, wager:3000000, reward:550, week:55 },{ lv:9, wager:4000000, reward:700, week:85 },
  { lv:10, wager:5000000, reward:800, week:110 }
];
function vipInfo(w) { let lv=1; for(let i=1;i<VIP.length;i++) if(w>=VIP[i].wager) lv=VIP[i].lv; return VIP.find(v=>v.lv===lv)||VIP[0]; }

const onlineUsers = new Map();
setInterval(() => { const now=Date.now(); for(const [k,t] of onlineUsers) if(now-t>30000) onlineUsers.delete(k); }, 10000);

const pn = ["鱼","虾","蟹","葫芦","金钱","鸡"];
const dc = [
  ["鱼","虾"],["鱼","蟹"],["鱼","葫芦"],["鱼","金钱"],["鱼","鸡"],
  ["虾","蟹"],["虾","葫芦"],["虾","金钱"],["虾","鸡"],
  ["蟹","葫芦"],["蟹","金钱"],["蟹","鸡"],
  ["葫芦","金钱"],["葫芦","鸡"],["金钱","鸡"]
];

let gameState = { round:1, phase:0, secondsRemaining:25, results:[null,null,null], bets:{}, totalBets:0, roundResult:{}, dealerProfit:0 };
let gameHistory = readJSON(HISTORY_FILE);
let paused = false, gameLock = false;
let dealerState = { active:false, account:null, displayId:null, grabTime:null };

function createWeightedPicker(probWeight) {
  const weights = pn.map(p => (p==='鱼'||p==='虾'||p==='蟹')?probWeight:100-probWeight);
  const total = weights.reduce((a,b)=>a+b,0);
  return () => { let r=Math.random()*total; for(let i=0;i<pn.length;i++){ r-=weights[i]; if(r<=0) return pn[i]; } return pn[pn.length-1]; };
}
let weightedPick = createWeightedPicker(50);

function changePhase() {
  if(gameState.phase===0){ if(gameLock)return; gameLock=true; const cf=readJSON(CONFIG_FILE); const pw=cf.probWeight||50; if(!weightedPick||pw!==(cf.probWeight||50)) weightedPick=createWeightedPicker(pw); const r1=weightedPick(),r2=weightedPick(),r3=weightedPick(); gameState.results=[r1,r2,r3]; gameState.phase=1; gameState.secondsRemaining=6; settleRound(r1,r2,r3); gameLock=false; }
  else if(gameState.phase===1){ gameState.phase=2; gameState.secondsRemaining=4; }
  else if(gameState.phase===2){ gameState.round++; gameState.bets={}; gameState.totalBets=0; gameState.roundResult={}; dealerState={active:false,account:null,displayId:null,grabTime:null}; gameState.dealerProfit=0; gameState.phase=0; gameState.secondsRemaining=25; }
}

function settleRound(r1, r2, r3) {
  const users = readJSON(USERS_FILE);
  const cf = readJSON(CONFIG_FILE);
  const adj = cf.adjustFactor || 0.98;
  const occurs = {}; pn.forEach(p => occurs[p]=0);
  [r1,r2,r3].forEach(p => occurs[p]++);
  let totalBetAmount = 0, totalReturnAmount = 0;

  for (let acc in gameState.bets) {
    const ub = gameState.bets[acc];
    const user = users.find(u => u.account === acc);
    if (!user) continue;
    let ret = 0;
    const wd = {};
    for (let p in ub.single) {
      if (ub.single[p] > 0 && occurs[p] > 0) {
        const r = ub.single[p] + ub.single[p] * occurs[p] * adj;
        ret += r; wd[p] = r;
      }
    }
    for (let key in ub.double) {
      if (ub.double[key] > 0) {
        const combo = key.split(',');
        if (occurs[combo[0]] > 0 && occurs[combo[1]] > 0) {
          let profit = ub.double[key] * 5 * adj;
          if ([r1,r2,r3].every(f => combo.includes(f))) profit += ub.double[key] * 2 * adj;
          const r = ub.double[key] + profit;
          ret += r; wd[key] = r;
        }
      }
    }
    // 修复：只加回报总额，本金在下注时已扣
    user.balance += ret;

    if (!user.records) user.records = [];
    user.records.push({
      type: 'settle',
      amount: ret,
      balance: user.balance,
      time: new Date().toISOString(),
      round: gameState.round,
      detail: { bet: ub.totalBet, return: ret, winDetails: wd }
    });

    if (!user.vip) user.vip = { level:1, totalWager:0, weeklyClaimed:null, upgradeRewards:[] };
    user.vip.totalWager = (user.vip.totalWager||0) + ub.totalBet;
    gameState.roundResult[acc] = { totalReturn: ret, winDetails: wd };
    totalBetAmount += ub.totalBet;
    totalReturnAmount += ret;
  }

  let dealerProfit = 0;
  if (dealerState.active && dealerState.account) {
    const dealer = users.find(u => u.account === dealerState.account);
    if (dealer) {
      const gross = totalBetAmount - totalReturnAmount;
      let fee = 0;
      if (gross > 0) { fee = gross * (cf.serviceFee || 0.02); cf.bankerBalance += fee; }
      const net = gross - fee;
      dealer.balance += net;
      dealer.balance += 2000;
      if (!dealer.records) dealer.records = [];
      dealer.records.push({ type:'dealer_settle', amount: net+2000, balance:dealer.balance, time:new Date().toISOString() });
      dealerProfit = net;
    }
  }
  gameState.dealerProfit = dealerProfit;
  writeJSON(CONFIG_FILE, cf);
  writeJSON(USERS_FILE, users);

  gameHistory.push({
    round: gameState.round,
    dealer: dealerState.active ? dealerState.displayId : null,
    dice: `${r1},${r2},${r3}`,
    time: new Date().toLocaleTimeString(),
    bets: JSON.parse(JSON.stringify(gameState.bets)),
    roundResult: JSON.parse(JSON.stringify(gameState.roundResult)),
    dealerProfit
  });
  if (gameHistory.length > 100) gameHistory.shift();
  writeJSON(HISTORY_FILE, gameHistory);
}

setInterval(() => { if(paused) return; if(gameState.secondsRemaining>0) gameState.secondsRemaining--; if(gameState.secondsRemaining<=0) changePhase(); }, 1000);

const captchaStore = new Map();
app.get('/api/captcha', (req, res) => {
  const svgWidth=100, svgHeight=36;
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code='';
  for(let i=0;i<4;i++) code+=chars[Math.floor(Math.random()*chars.length)];
  const token=Date.now().toString(36)+Math.random().toString(36).substr(2,6);
  captchaStore.set(token,{code,expire:Date.now()+60000});
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}"><rect width="100%" height="100%" fill="#f0e6d2" rx="6"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="'Comic Sans MS', cursive, sans-serif" font-size="24" font-weight="bold" fill="#2a1a0a" stroke="#aa6600" stroke-width="0.5" transform="rotate(${Math.random()*4-2},50,18)">${code}</text><line x1="10" y1="8" x2="40" y2="28" stroke="#c99a3b" stroke-width="0.8" opacity="0.4"/><line x1="70" y1="6" x2="90" y2="30" stroke="#c99a3b" stroke-width="0.8" opacity="0.4"/></svg>`;
  res.json({ token, svg: Buffer.from(svg).toString('base64') });
});

app.post('/api/login', (req, res) => {
  const { account, password } = req.body;
  const users = readJSON(USERS_FILE);
  const u = users.find(u => u.account === account || u.phone === account || u.email === account);
  if (!u) return res.status(400).json({ msg:'账号不存在' });
  if (u.password !== password) return res.status(400).json({ msg:'密码错误' });
  if (!u.vip) u.vip = { level:1, totalWager:0, weeklyClaimed:null, upgradeRewards:[] };
  res.json({ success:true, user: { account:u.account, phone:u.phone, email:u.email, balance:u.balance, vip:u.vip } });
});

app.post('/api/register', (req,res) => {
  const { account, password, referralCode, phone, email, captchaToken, captchaInput } = req.body;
  const validCodes = ["VIP666","888VIP","GOLD2025","LUCKY8","DICE100"];
  if (!validCodes.includes(referralCode)) return res.status(400).json({ msg:'推荐码无效' });
  if (!phone && !email) return res.status(400).json({ msg:'请填写手机号或邮箱' });
  if (phone && !/^1[3-9]\d{9}$/.test(phone)) return res.status(400).json({ msg:'手机号格式不正确' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ msg:'邮箱格式不正确' });
  if (!captchaToken || !captchaInput) return res.status(400).json({ msg:'验证码不能为空' });
  const cap = captchaStore.get(captchaToken);
  if (!cap || Date.now() > cap.expire) return res.status(400).json({ msg:'验证码已过期，请刷新' });
  if (cap.code !== captchaInput.toUpperCase()) return res.status(400).json({ msg:'验证码错误' });
  captchaStore.delete(captchaToken);
  const users = readJSON(USERS_FILE);
  if (users.find(u => u.account === account)) return res.status(400).json({ msg:'账号已存在' });
  if (phone && users.find(u => u.phone === phone)) return res.status(400).json({ msg:'手机号已注册' });
  if (email && users.find(u => u.email === email)) return res.status(400).json({ msg:'邮箱已注册' });
  const nu = { account, password, balance:0, phone:phone||'', email:email||'', vip:{ level:1, totalWager:0, weeklyClaimed:null, upgradeRewards:[] }, records:[] };
  users.push(nu); writeJSON(USERS_FILE, users);
  res.json({ success:true, user: { account:nu.account, phone:nu.phone, email:nu.email, balance:nu.balance, vip:nu.vip } });
});

app.get('/api/user/:account/profile', (req,res) => {
  const u = readJSON(USERS_FILE).find(u => u.account === req.params.account);
  if (!u) return res.status(404).json({ msg:'不存在' });
  if (!u.vip) u.vip = { level:1, totalWager:0, weeklyClaimed:null, upgradeRewards:[] };
  res.json({ user: { account:u.account, phone:u.phone||'', email:u.email||'', balance:u.balance, vip:u.vip, records:(u.records||[]).slice(-100) } });
});

app.put('/api/user/:account/balance', (req,res) => {
  const users = readJSON(USERS_FILE);
  const u = users.find(u => u.account === req.params.account);
  if (!u) return res.status(404).json({ msg:'不存在' });
  const oldBalance = u.balance;
  u.balance = req.body.balance;
  if (req.body.admin) {
    if (!u.records) u.records = [];
    u.records.push({ type: u.balance>oldBalance?'admin_add':'admin_sub', amount: u.balance-oldBalance, balance: u.balance, time: new Date().toISOString(), detail:{operator:'admin'} });
  }
  writeJSON(USERS_FILE, users);
  res.json({ msg:'ok' });
});

app.get('/api/ping', (req,res) => res.json({ ok:true }));

app.get('/api/game/state', (req, res) => {
  const acc = req.query.account || '';
  let betSummary = null;
  if (dealerState.active && acc === dealerState.account) {
    betSummary = { single:{}, double:{}, totalPlayers: Object.keys(gameState.bets).length, totalBets: gameState.totalBets };
    pn.forEach(p => betSummary.single[p]=0); dc.forEach(c => betSummary.double[c.join(',')]=0);
    for (let a in gameState.bets) { const ub = gameState.bets[a]; for (let p in ub.single) betSummary.single[p] += ub.single[p]; for (let k in ub.double) betSummary.double[k] += ub.double[k]; }
  }
  res.json({ round: gameState.round, phase: gameState.phase, secondsRemaining: gameState.secondsRemaining, results: gameState.results, totalPlayers: Object.keys(gameState.bets).length, totalBets: gameState.totalBets, dealer: dealerState.active ? dealerState.displayId : null, myBets: gameState.bets[acc] || null, myResult: gameState.roundResult[acc] || null, dealerProfit: dealerState.active && acc === dealerState.account ? gameState.dealerProfit : undefined, betSummary, paused });
});

app.post('/api/game/bet', (req, res) => {
  if (gameLock) return res.status(400).json({ msg:'开奖中' });
  const { account, single, double } = req.body;
  if (!account) return res.status(400).json({ msg:'缺少账号' });
  if (gameState.phase !== 0) return res.status(400).json({ msg:'已截止' });
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.account === account);
  if (!user) return res.status(400).json({ msg:'用户不存在' });
  let amount = 0;
  if (single) for (let p in single) amount += single[p];
  if (double) for (let k in double) amount += double[k];
  if (amount <= 0) return res.status(400).json({ msg:'无效投注' });
  if (user.balance < amount) return res.status(400).json({ msg:'余额不足' });
  user.balance -= amount;
  if (!user.records) user.records = [];
  user.records.push({ type:'bet', amount: -amount, balance: user.balance, time: new Date().toISOString(), round: gameState.round, detail: { single, double } });
  writeJSON(USERS_FILE, users);
  if (!gameState.bets[account]) gameState.bets[account] = { single:{}, double:{}, totalBet:0 };
  const my = gameState.bets[account];
  if (single) for (let p in single) my.single[p] = (my.single[p]||0) + single[p];
  if (double) for (let k in double) my.double[k] = (my.double[k]||0) + double[k];
  my.totalBet += amount;
  gameState.totalBets += amount;
  res.json({ msg:'投注成功', totalBet: my.totalBet, balance: user.balance });
});

app.post('/api/game/clearbet', (req, res) => {
  const { account } = req.body;
  if (!account) return res.status(400).json({ msg:'缺少账号' });
  if (gameState.phase !== 0) return res.status(400).json({ msg:'已截止下注' });
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.account === account);
  if (!user) return res.status(400).json({ msg:'用户不存在' });
  const myBets = gameState.bets[account];
  if (!myBets || myBets.totalBet === 0) return res.json({ msg:'没有可清除的投注', balance: user.balance });
  user.balance += myBets.totalBet;
  if (!user.records) user.records = [];
  user.records.push({ type:'bet_clear', amount: myBets.totalBet, balance: user.balance, time: new Date().toISOString(), round: gameState.round, detail: { cleared: myBets } });
  gameState.totalBets -= myBets.totalBet;
  delete gameState.bets[account];
  writeJSON(USERS_FILE, users);
  res.json({ msg:'投注已清除并退款', balance: user.balance });
});

app.post('/api/game/grab-dealer', (req, res) => {
  const { account } = req.body;
  if (!account) return res.status(400).json({ msg:'缺少账号' });
  if (gameState.phase !== 0) return res.status(400).json({ msg:'不在下注阶段' });
  if (dealerState.active) return res.status(400).json({ msg:'已有庄家' });
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.account === account);
  if (!user) return res.status(400).json({ msg:'用户不存在' });
  if (user.balance < 2000) return res.status(400).json({ msg:'余额不足2000' });
  user.balance -= 2000;
  if (!user.records) user.records = [];
  user.records.push({ type:'dealer_grab', amount:-2000, balance:user.balance, time:new Date().toISOString() });
  writeJSON(USERS_FILE, users);
  dealerState.active = true; dealerState.account = account; dealerState.displayId = account.substring(0,2)+'****'+account.slice(-2); dealerState.grabTime = Date.now();
  const summary = { single:{}, double:{}, totalPlayers: Object.keys(gameState.bets).length, totalBets: gameState.totalBets };
  pn.forEach(p => summary.single[p]=0); dc.forEach(c => summary.double[c.join(',')]=0);
  for (let a in gameState.bets) { const ub = gameState.bets[a]; for (let p in ub.single) summary.single[p] += ub.single[p]; for (let k in ub.double) summary.double[k] += ub.double[k]; }
  res.json({ msg:'抢庄成功', balance: user.balance, betSummary: summary });
});

app.get('/api/users', (req,res) => res.json(readJSON(USERS_FILE).map(u => ({ account:u.account, balance:u.balance, vip:u.vip }))));
app.get('/api/user/:account/balance', (req,res) => { const u = readJSON(USERS_FILE).find(u => u.account === req.params.account); if (!u) return res.status(404).json({ msg:'不存在' }); res.json({ balance:u.balance }); });
app.get('/api/config', (req,res) => res.json(readJSON(CONFIG_FILE)));
app.put('/api/config', (req,res) => { writeJSON(CONFIG_FILE, { ...readJSON(CONFIG_FILE), ...req.body }); res.json({ msg:'ok' }); });

app.post('/api/recharge', (req,res) => { const recs = readJSON(RECHARGE_FILE); recs.push({ id:Date.now(), account:req.body.account, amount:req.body.amount, status:'pending' }); writeJSON(RECHARGE_FILE, recs); res.json({ msg:'已提交' }); });
app.put('/api/recharge/:id', (req,res) => { const recs = readJSON(RECHARGE_FILE); const o = recs.find(o => o.id === Number(req.params.id)); if (!o) return res.status(404).json({ msg:'不存在' }); if (req.body.status === 'approved' && o.status !== 'approved') { const users = readJSON(USERS_FILE); const u = users.find(u => u.account === o.account); if (u) { u.balance += o.amount; if (!u.records) u.records = []; u.records.push({ type:'recharge', amount: o.amount, balance: u.balance, time: new Date().toISOString(), detail: { orderId: o.id } }); writeJSON(USERS_FILE, users); } } o.status = req.body.status; writeJSON(RECHARGE_FILE, recs); res.json({ msg:'ok' }); });
app.post('/api/withdraw', (req,res) => { const wds = readJSON(WITHDRAW_FILE); wds.push({ id:Date.now(), account:req.body.account, amount:req.body.amount, address:req.body.address, status:'pending' }); writeJSON(WITHDRAW_FILE, wds); res.json({ msg:'已提交' }); });
app.put('/api/withdraw/:id', (req,res) => { const wds = readJSON(WITHDRAW_FILE); const o = wds.find(o => o.id === Number(req.params.id)); if (!o) return res.status(404).json({ msg:'不存在' }); if (req.body.status === 'approved' && o.status !== 'approved') { const users = readJSON(USERS_FILE); const u = users.find(u => u.account === o.account); if (u) { if (u.balance < o.amount) return res.status(400).json({ msg:'余额不足' }); u.balance -= o.amount; if (!u.records) u.records = []; u.records.push({ type:'withdraw', amount: -o.amount, balance: u.balance, time: new Date().toISOString(), detail: { orderId: o.id, address: o.address } }); writeJSON(USERS_FILE, users); } } o.status = req.body.status; writeJSON(WITHDRAW_FILE, wds); res.json({ msg:'ok' }); });
app.get('/api/recharges/pending', (req,res) => res.json(readJSON(RECHARGE_FILE)));
app.get('/api/withdraws/pending', (req,res) => res.json(readJSON(WITHDRAW_FILE)));
app.get('/api/game/history', (req,res) => res.json({ list: gameHistory }));
app.get('/api/user/:account/game-records', (req,res) => { const records = gameHistory.filter(h => h.bets && h.bets[req.params.account]).slice(-100).map(h => ({ round: h.round, dealer: h.dealer||'无', dice: h.dice, time: h.time, bet: h.bets[req.params.account]?.totalBet||0, return: h.roundResult[req.params.account]?.totalReturn||0, dealerProfit: h.dealerProfit })); res.json({ records }); });
app.get('/api/admin/dealer-records', (req,res) => res.json({ records: gameHistory.filter(h => h.dealer).map(h => ({ round: h.round, dealer: h.dealer, dice: h.dice, time: h.time, profit: h.dealerProfit||0 })) }));

app.post('/api/heartbeat', (req, res) => { const body = req.body || {}; if (body.deviceId) onlineUsers.set(body.deviceId, Date.now()); res.json({ online: onlineUsers.size }); });
app.get('/api/online', (req, res) => res.json({ count: onlineUsers.size }));

app.post('/api/game/next', (req,res) => { changePhase(); res.json({ msg:'ok' }); });
app.post('/api/game/pause', (req,res) => { paused=true; res.json({ msg:'暂停' }); });
app.post('/api/game/resume', (req,res) => { paused=false; res.json({ msg:'恢复' }); });
app.post('/api/game/reset', (req,res) => { gameState = { round:1, phase:0, secondsRemaining:25, results:[null,null,null], bets:{}, totalBets:0, roundResult:{}, dealerProfit:0 }; dealerState = { active:false, account:null, displayId:null, grabTime:null }; gameHistory = []; writeJSON(HISTORY_FILE, []); paused = false; res.json({ msg:'重置' }); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`✅ 服务器启动，端口：${PORT}`));