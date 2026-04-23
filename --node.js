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
