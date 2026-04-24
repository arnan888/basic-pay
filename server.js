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


