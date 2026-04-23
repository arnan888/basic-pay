const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const jwt = require('jsonwebtoken');

const app = express();
const port = 3000;
const JWT_SECRET = 'your_jwt_secret_change_me';

app.use(cors());
app.use(bodyParser.json());

// 托管静态文件（前端页面）
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database('./game.db');

// 初始化表
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
        account TEXT NOT NULL,
        amount REAL NOT NULL,
        order_no TEXT,
        remark TEXT,
        time TEXT,
        status TEXT DEFAULT 'pending'
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS withdraws (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account TEXT NOT NULL,
        amount REAL NOT NULL,
        type TEXT,
        account_no TEXT,
        time TEXT
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
                [account, hashed, new Date().toLocaleString(), '[]', '[]'], (err) => {
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
        res.json({ success: true, account: user.account, balance: user.balance, token });
    });
});

// 获取用户信息（需要token）
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

// 充值申请
app.post('/api/recharge', (req, res) => {
    const { account, amount, usdt_amount, tx_hash } = req.body;
    if (!account || !amount || amount <= 0) return res.status(400).json({ error: '参数错误' });
    db.run('INSERT INTO pending_recharges (account, amount, order_no, remark, time, status) VALUES (?, ?, ?, ?, ?, ?)',
        [account, amount, tx_hash || '', '', new Date().toLocaleString(), 'pending'], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: '充值申请已提交' });
        });
});

// 提现申请
app.post('/api/withdraw', (req, res) => {
    const { account, amount, usdt_address } = req.body;
    if (!account || !amount || amount <= 0 || !usdt_address) return res.status(400).json({ error: '参数错误' });
    db.get('SELECT balance FROM users WHERE account = ?', [account], (err, user) => {
        if (err || !user) return res.status(404).json({ error: '用户不存在' });
        if (user.balance < amount) return res.status(400).json({ error: '余额不足' });
        db.run('INSERT INTO withdraws (account, amount, type, account_no, time) VALUES (?, ?, ?, ?, ?)',
            [account, amount, 'USDT', usdt_address, new Date().toLocaleString()], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, message: '提现申请已提交' });
            });
    });
});

// 获取系统配置
app.get('/api/config', async (req, res) => {
    const banker = await getConfig('systemBankerBalance');
    const factor = await getConfig('adjustFactor');
    res.json({ banker_balance: banker || 50000, adjust_factor: factor || 1.0 });
});

// 游戏结算（核心）
app.post('/api/game/settle', async (req, res) => {
    const { account, totalBet, winAmount } = req.body;
    if (!account || totalBet === undefined || winAmount === undefined) return res.status(400).json({ error: '参数错误' });
    const client = await new Promise((resolve) => resolve(db));
    try {
        await new Promise((resolve, reject) => {
            db.get('BEGIN', (err) => { if (err) reject(err); else resolve(); });
        });
        const user = await new Promise((resolve, reject) => {
            db.get('SELECT balance FROM users WHERE account = ?', [account], (err, row) => {
                if (err) reject(err); else resolve(row);
            });
        });
        if (!user) throw new Error('用户不存在');
        if (user.balance < totalBet) throw new Error('余额不足');
        const newBalance = user.balance - totalBet + winAmount;
        await new Promise((resolve, reject) => {
            db.run('UPDATE users SET balance = ? WHERE account = ?', [newBalance, account], (err) => {
                if (err) reject(err); else resolve();
            });
        });
        let bankerBalance = await getConfig('systemBankerBalance');
        const bankerDelta = totalBet - winAmount;
        const newBanker = bankerBalance + bankerDelta;
        await setConfig('systemBankerBalance', newBanker);
        await new Promise((resolve, reject) => {
            db.run('COMMIT', (err) => { if (err) reject(err); else resolve(); });
        });
        res.json({ success: true, newBalance, bankerDelta });
    } catch (err) {
        await new Promise((resolve) => { db.run('ROLLBACK', () => resolve()); });
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// 管理员登录
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === 'admin888') {
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

// 获取待审核充值
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
        db.get('SELECT account, amount FROM pending_recharges WHERE id = ?', [orderId], (err, order) => {
            if (err || !order) { db.run('ROLLBACK'); return res.status(404).json({ error: '订单不存在' }); }
            db.run('UPDATE users SET balance = balance + ? WHERE account = ?', [order.amount, order.account], (err) => {
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
    db.all('SELECT * FROM withdraws ORDER BY id DESC', (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 审核通过提现（扣减用户余额）
app.post('/api/admin/approve_withdraw', adminAuth, (req, res) => {
    const { orderId } = req.body;
    db.serialize(() => {
        db.get('BEGIN');
        db.get('SELECT account, amount FROM withdraws WHERE id = ?', [orderId], (err, order) => {
            if (err || !order) { db.run('ROLLBACK'); return res.status(404).json({ error: '订单不存在' }); }
            db.get('SELECT balance FROM users WHERE account = ?', [order.account], (err, user) => {
                if (err || !user) { db.run('ROLLBACK'); return res.status(404).json({ error: '用户不存在' }); }
                if (user.balance < order.amount) { db.run('ROLLBACK'); return res.status(400).json({ error: '用户余额不足' }); }
                db.run('UPDATE users SET balance = balance - ? WHERE account = ?', [order.amount, order.account], (err) => {
                    if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
                    db.run('DELETE FROM withdraws WHERE id = ?', [orderId], (err) => {
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
    db.run('DELETE FROM withdraws WHERE id = ?', [orderId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// 修改系统配置（庄家余额、抽水系数）
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

// 启动服务器
app.listen(port, '0.0.0.0', () => {
    console.log(`✅ 后端运行在 http://0.0.0.0:${port}`);
});
