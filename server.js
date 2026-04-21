const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

const DATA_FILE = path.join(__dirname, 'data.json');

if (!fs.existsSync(DATA_FILE)) {
    const initData = {
        users: {},
        withdrawRecords: [],
        systemBankerBalance: 50000,
        adjustFactor: 1.0,
        validReferralCodes: ["VIP666", "888VIP", "GOLD2025", "LUCKY8", "DICE100"]
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initData, null, 2));
}

function readData() {
    const raw = fs.readFileSync(DATA_FILE);
    return JSON.parse(raw);
}
function writeData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('.'));

const sessions = new Map();

function generateToken() {
    return Math.random().toString(36).substring(2) + Date.now();
}

app.post('/api/register', (req, res) => {
    const { account, password, referralCode, verificationCode } = req.body;
    let data = readData();
    if (data.users[account]) return res.json({ success: false, message: '账号已存在' });
    if (!data.validReferralCodes.includes(referralCode)) return res.json({ success: false, message: '推荐码无效' });
    if (verificationCode !== '123456') return res.json({ success: false, message: '验证码错误' });
    data.users[account] = {
        password, balance: 0, referralCode, registerTime: new Date().toLocaleString(),
        records: [], resultHistory: []
    };
    writeData(data);
    res.json({ success: true, message: '注册成功' });
});

app.post('/api/login', (req, res) => {
    const { account, password } = req.body;
    let data = readData();
    const user = data.users[account];
    if (!user || user.password !== password) return res.json({ success: false, message: '账号或密码错误' });
    const token = generateToken();
    sessions.set(token, account);
    res.json({ success: true, token, account, balance: user.balance });
});

app.get('/api/user', (req, res) => {
    const token = req.headers.authorization;
    const account = sessions.get(token);
    if (!account) return res.status(401).json({ success: false });
    let data = readData();
    const user = data.users[account];
    res.json({ success: true, account, balance: user.balance, records: user.records });
});

app.post('/api/settle', (req, res) => {
    const { token, betAmount, winAmount, betInfo, result, gameName } = req.body;
    const account = sessions.get(token);
    if (!account) return res.status(401).json({ success: false });
    let data = readData();
    const user = data.users[account];
    if (!user) return res.json({ success: false, message: '用户不存在' });
    const newBalance = user.balance - betAmount + winAmount;
    if (newBalance < 0) return res.json({ success: false, message: '余额不足' });
    user.balance = newBalance;
    user.records.unshift({
        time: new Date().toLocaleString(),
        game: gameName || '未知游戏',
        bet: betInfo,
        result: result,
        win: winAmount,
        amount: betAmount
    });
    if (user.records.length > 100) user.records.pop();
    writeData(data);
    res.json({ success: true, newBalance });
});

app.get('/api/admin/users', (req, res) => {
    const adminToken = req.headers.admintoken;
    if (adminToken !== 'admin888') return res.status(401).json({ success: false });
    let data = readData();
    const usersList = Object.keys(data.users).map(acc => ({
        account: acc,
        balance: data.users[acc].balance,
        regTime: data.users[acc].registerTime,
        referralCode: data.users[acc].referralCode,
        records: data.users[acc].records
    }));
    res.json({ success: true, users: usersList });
});

app.post('/api/admin/balance', (req, res) => {
    const { adminToken, targetAccount, amount, action } = req.body;
    if (adminToken !== 'admin888') return res.json({ success: false });
    let data = readData();
    if (!data.users[targetAccount]) return res.json({ success: false, message: '用户不存在' });
    if (action === 'add') data.users[targetAccount].balance += amount;
    else if (action === 'sub') {
        if (data.users[targetAccount].balance < amount) return res.json({ success: false, message: '余额不足' });
        data.users[targetAccount].balance -= amount;
    } else if (action === 'reset') data.users[targetAccount].balance = 0;
    writeData(data);
    res.json({ success: true, newBalance: data.users[targetAccount].balance });
});

app.get('/api/system', (req, res) => {
    let data = readData();
    res.json({ success: true, systemBankerBalance: data.systemBankerBalance, adjustFactor: data.adjustFactor });
});

app.post('/api/admin/system', (req, res) => {
    const { adminToken, systemBankerBalance, adjustFactor } = req.body;
    if (adminToken !== 'admin888') return res.json({ success: false });
    let data = readData();
    if (systemBankerBalance !== undefined) data.systemBankerBalance = systemBankerBalance;
    if (adjustFactor !== undefined) data.adjustFactor = adjustFactor;
    writeData(data);
    res.json({ success: true });
});

app.post('/api/recharge', (req, res) => {
    const { token, amount } = req.body;
    const account = sessions.get(token);
    if (!account) return res.status(401).json({ success: false });
    res.json({ success: true, message: '充值申请已提交，请联系客服' });
});

app.post('/api/withdraw', (req, res) => {
    const { token, amount, type, account: withdrawAccount } = req.body;
    const account = sessions.get(token);
    if (!account) return res.status(401).json({ success: false });
    let data = readData();
    const user = data.users[account];
    if (user.balance < amount) return res.json({ success: false, message: '余额不足' });
    user.balance -= amount;
    data.withdrawRecords.push({ account, amount, type, withdrawAccount, time: new Date().toLocaleString(), status: '待处理' });
    writeData(data);
    res.json({ success: true });
});
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ 后端运行成功！同网访问: http://192.168.100.216:${PORT}`);
});
