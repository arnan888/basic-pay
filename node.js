const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());

// ========== 修改下面的数据库连接信息 ==========
const pool = new Pool({
    user: 'postgres',      // 你的数据库用户名
    host: 'localhost',
    database: 'your_db',   // 你的数据库名
    password: 'your_password', // 你的密码
    port: 5432,
});

// 辅助：获取当前时间字符串
function nowStr() {
    return new Date().toLocaleString('zh-CN', { hour12: false });
}

// ========== 注册 ==========
app.post('/api/register', async (req, res) => {
    const { account, password } = req.body;
    if (!account || !password) return res.status(400).json({ error: '账号密码不能为空' });
    try {
        const exist = await pool.query('SELECT id FROM users WHERE account = $1', [account]);
        if (exist.rows.length > 0) return res.status(400).json({ error: '账号已存在' });
        const hashed = await bcrypt.hash(password, 10);
        await pool.query(
            `INSERT INTO users (account, password, register_time, balance, records, result_history)
             VALUES ($1, $2, $3, 0, '[]', '[]')`,
            [account, hashed, nowStr()]
        );
        res.json({ success: true, message: '注册成功' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '服务器错误' });
    }
});

// ========== 登录 ==========
app.post('/api/login', async (req, res) => {
    const { account, password } = req.body;
    if (!account || !password) return res.status(400).json({ error: '账号密码不能为空' });
    try {
        const result = await pool.query('SELECT account, password, balance FROM users WHERE account = $1', [account]);
        if (result.rows.length === 0) return res.status(401).json({ error: '账号不存在' });
        const user = result.rows[0];
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: '密码错误' });
        res.json({ success: true, account: user.account, balance: user.balance });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '服务器错误' });
    }
});

// ========== 获取用户信息 ==========
app.get('/api/user/:account', async (req, res) => {
    const { account } = req.params;
    try {
        const result = await pool.query('SELECT account, balance FROM users WHERE account = $1', [account]);
        if (result.rows.length === 0) return res.status(404).json({ error: '用户不存在' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: '服务器错误' });
    }
});

// ========== 充值 ==========
app.post('/api/recharge', async (req, res) => {
    const { account, amount, remark = '' } = req.body;
    if (!account || !amount || amount <= 0) return res.status(400).json({ error: '金额无效' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const update = await client.query(
            'UPDATE users SET balance = balance + $1 WHERE account = $2 RETURNING balance',
            [amount, account]
        );
        if (update.rowCount === 0) throw new Error('账号不存在');
        const newBalance = update.rows[0].balance;
        const orderNo = `R${Date.now()}`;
        await client.query(
            `INSERT INTO pending_recharges (account, amount, order_no, remark, time, status)
             VALUES ($1, $2, $3, $4, $5, 'approved')`,
            [account, amount, orderNo, remark, nowStr()]
        );
        // 追加 records
        const recordItem = { type: 'recharge', amount, time: nowStr(), orderNo };
        await client.query(
            `UPDATE users SET records = records || $1::jsonb WHERE account = $2`,
            [JSON.stringify([recordItem]), account]
        );
        await client.query('COMMIT');
        res.json({ success: true, newBalance, message: `充值 ${amount} 成功` });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: err.message || '充值失败' });
    } finally {
        client.release();
    }
});

// ========== 提现 ==========
app.post('/api/withdraw', async (req, res) => {
    const { account, amount, type = 'USDT', accountNo = '' } = req.body;
    if (!account || !amount || amount <= 0) return res.status(400).json({ error: '金额无效' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userRes = await client.query('SELECT balance FROM users WHERE account = $1', [account]);
        if (userRes.rowCount === 0) throw new Error('账号不存在');
        const currentBalance = userRes.rows[0].balance;
        if (currentBalance < amount) throw new Error('余额不足');
        const update = await client.query(
            'UPDATE users SET balance = balance - $1 WHERE account = $2 RETURNING balance',
            [amount, account]
        );
        const newBalance = update.rows[0].balance;
        await client.query(
            `INSERT INTO withdraws (account, amount, type, account_no, time)
             VALUES ($1, $2, $3, $4, $5)`,
            [account, amount, type, accountNo, nowStr()]
        );
        const recordItem = { type: 'withdraw', amount, time: nowStr(), accountNo };
        await client.query(
            `UPDATE users SET records = records || $1::jsonb WHERE account = $2`,
            [JSON.stringify([recordItem]), account]
        );
        await client.query('COMMIT');
        res.json({ success: true, newBalance, message: `提现 ${amount} 成功` });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.listen(port, () => {
    console.log(`✅ 后端运行在 http://localhost:${port}`);
});








