const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());

// 数据库配置（⚠️ 修改成你自己的）
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'your_db',
    password: 'your_password',
    port: 5432,
});

function nowStr() {
    return new Date().toLocaleString('zh-CN', { hour12: false });
}

// ========== 原有 API（注册、登录、获取用户、充值、提现）保持不变 ==========
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

// ========== 🎲 新增：游戏下注 API ==========
app.post('/api/game/bet', async (req, res) => {
    const { account, betAmount, choice } = req.body;  // choice: 'big' 或 'small'
    if (!account || !betAmount || betAmount <= 0) {
        return res.status(400).json({ error: '无效的下注金额' });
    }
    if (choice !== 'big' && choice !== 'small') {
        return res.status(400).json({ error: '请选择大或小' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 获取当前余额
        const userRes = await client.query('SELECT balance FROM users WHERE account = $1', [account]);
        if (userRes.rowCount === 0) throw new Error('账号不存在');
        let currentBalance = userRes.rows[0].balance;
        if (currentBalance < betAmount) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: '余额不足，无法下注' });
        }

        // 掷骰子 1~6
        const dice = Math.floor(Math.random() * 6) + 1;
        const isBig = dice >= 4;
        const win = (choice === 'big' && isBig) || (choice === 'small' && !isBig);
        let newBalance, winAmount = 0, resultText;

        if (win) {
            // 赢了：获得下注金额的 1.95 倍（略低于2倍，模拟抽水，也可以直接给2倍）
            const multiplier = 1.95;
            winAmount = Math.floor(betAmount * multiplier);
            newBalance = currentBalance - betAmount + winAmount;
            resultText = `🎉 赢了！骰子 ${dice}，获得 ${winAmount}`;
        } else {
            newBalance = currentBalance - betAmount;
            resultText = `😭 输了！骰子 ${dice}，损失 ${betAmount}`;
        }

        // 更新余额
        await client.query('UPDATE users SET balance = $1 WHERE account = $2', [newBalance, account]);

        // 记录游戏结果到 result_history（你表里定义的字段）
        const gameRecord = {
            type: 'dice',
            bet: betAmount,
            choice: choice === 'big' ? '大' : '小',
            dice: dice,
            win: win,
            winAmount: win ? winAmount : 0,
            time: nowStr(),
            balanceAfter: newBalance
        };
        await client.query(
            `UPDATE users SET result_history = result_history || $1::jsonb WHERE account = $2`,
            [JSON.stringify([gameRecord]), account]
        );

        await client.query('COMMIT');
        res.json({
            success: true,
            dice: dice,
            win: win,
            winAmount: win ? winAmount : 0,
            newBalance: newBalance,
            message: resultText
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: err.message || '下注失败' });
    } finally {
        client.release();
    }
});

app.listen(port, () => {
    console.log(`✅ 后端运行在 http://localhost:${port}`);
});

