const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const port = 3000;
const JWT_SECRET = 'your_jwt_secret_key_change_me';

app.use(cors());
app.use(bodyParser.json());

// PostgreSQL 配置（修改为你的实际配置）
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'game_db',
    password: 'your_password',
    port: 5432,
});

// 中间件：验证JWT
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: '未授权' });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'token无效' });
        req.user = user;
        next();
    });
}

// 获取平台配置（庄家余额、抽水系数）
async function getPlatformConfig() {
    const { rows } = await pool.query('SELECT key, value FROM platform_config');
    const config = {};
    rows.forEach(row => config[row.key] = parseFloat(row.value));
    return config;
}
async function updatePlatformConfig(key, value) {
    await pool.query('UPDATE platform_config SET value = $1 WHERE key = $2', [value, key]);
}

// 注册
app.post('/api/register', async (req, res) => {
    const { account, password } = req.body;
    if (!account || !password) return res.status(400).json({ error: '账号密码不能为空' });
    try {
        const exist = await pool.query('SELECT id FROM users WHERE account = $1', [account]);
        if (exist.rows.length) return res.status(400).json({ error: '账号已存在' });
        const hashed = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (account, password) VALUES ($1, $2)', [account, hashed]);
        res.json({ success: true, message: '注册成功' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '服务器错误' });
    }
});

// 登录
app.post('/api/login', async (req, res) => {
    const { account, password } = req.body;
    if (!account || !password) return res.status(400).json({ error: '账号密码不能为空' });
    try {
        const { rows } = await pool.query('SELECT id, account, password, balance FROM users WHERE account = $1', [account]);
        if (!rows.length) return res.status(401).json({ error: '账号不存在' });
        const user = rows[0];
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: '密码错误' });
        const token = jwt.sign({ id: user.id, account: user.account }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, account: user.account, balance: user.balance });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '服务器错误' });
    }
});

// 获取用户信息
app.get('/api/user', authenticateToken, async (req, res) => {
    const { rows } = await pool.query('SELECT id, account, balance FROM users WHERE id = $1', [req.user.id]);
    res.json(rows[0]);
});

// 修改密码
app.post('/api/change_password', authenticateToken, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword || newPassword.length < 4) return res.status(400).json({ error: '密码不合规' });
    const { rows } = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
    const match = await bcrypt.compare(oldPassword, rows[0].password);
    if (!match) return res.status(401).json({ error: '旧密码错误' });
    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, req.user.id]);
    res.json({ success: true });
});

// 充值申请（用户提交USDT转账信息）
app.post('/api/recharge', authenticateToken, async (req, res) => {
    const { amount, usdt_amount, tx_hash } = req.body;
    if (!amount || amount <= 0 || !usdt_amount || usdt_amount <= 0) return res.status(400).json({ error: '参数错误' });
    await pool.query(
        'INSERT INTO recharge_orders (user_id, amount, usdt_amount, tx_hash, status) VALUES ($1, $2, $3, $4, $5)',
        [req.user.id, amount, usdt_amount, tx_hash || '', 'pending']
    );
    res.json({ success: true, message: '充值申请已提交，等待审核' });
});

// 提现申请
app.post('/api/withdraw', authenticateToken, async (req, res) => {
    const { amount, usdt_address } = req.body;
    if (!amount || amount <= 0 || !usdt_address) return res.status(400).json({ error: '参数错误' });
    const user = await pool.query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
    if (user.rows[0].balance < amount) return res.status(400).json({ error: '余额不足' });
    await pool.query(
        'INSERT INTO withdraw_orders (user_id, amount, usdt_address, status) VALUES ($1, $2, $3, $4)',
        [req.user.id, amount, usdt_address, 'pending']
    );
    res.json({ success: true, message: '提现申请已提交，等待审核' });
});

// 获取平台配置（前端用）
app.get('/api/config', async (req, res) => {
    const config = await getPlatformConfig();
    res.json(config);
});

// ==================== 游戏结算接口 ====================
// 游戏结束时调用，更新玩家余额和庄家池
app.post('/api/game/settle', authenticateToken, async (req, res) => {
    const { totalBet, winAmount } = req.body;  // winAmount 是玩家实际赢得的金额（已扣除抽水）
    if (totalBet === undefined || winAmount === undefined) return res.status(400).json({ error: '参数错误' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // 获取当前玩家余额和庄家余额
        const userRes = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
        const config = await getPlatformConfig();
        let bankerBalance = config.banker_balance;
        // 庄家盈亏 = totalBet - winAmount
        const bankerDelta = totalBet - winAmount;
        if (bankerDelta < 0 && bankerBalance < -bankerDelta) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: '平台资金不足，暂无法赔付' });
        }
        const newBalance = userRes.rows[0].balance - totalBet + winAmount;
        await client.query('UPDATE users SET balance = $1 WHERE id = $2', [newBalance, req.user.id]);
        // 更新庄家余额
        await updatePlatformConfig('banker_balance', bankerBalance + bankerDelta);
        await client.query('COMMIT');
        res.json({ success: true, newBalance, bankerDelta });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: '结算失败' });
    } finally {
        client.release();
    }
});

// ==================== 管理员接口（简单权限，生产环境需要加强）====================
const ADMIN_PASSWORD = 'admin888'; // 简易，实际可用中间件
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

// 获取所有用户列表
app.get('/api/admin/users', adminAuth, async (req, res) => {
    const { rows } = await pool.query('SELECT id, account, balance, register_time FROM users');
    res.json(rows);
});

// 获取充值订单列表（待审核）
app.get('/api/admin/recharge_orders', adminAuth, async (req, res) => {
    const { rows } = await pool.query(`
        SELECT o.*, u.account FROM recharge_orders o
        JOIN users u ON o.user_id = u.id
        WHERE o.status = 'pending'
        ORDER BY o.created_at DESC
    `);
    res.json(rows);
});

// 审核充值（通过，增加用户余额）
app.post('/api/admin/approve_recharge', adminAuth, async (req, res) => {
    const { orderId } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const orderRes = await client.query('SELECT user_id, amount FROM recharge_orders WHERE id = $1 FOR UPDATE', [orderId]);
        if (!orderRes.rows.length) throw new Error('订单不存在');
        const order = orderRes.rows[0];
        await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [order.amount, order.user_id]);
        await client.query('UPDATE recharge_orders SET status = $1, updated_at = NOW() WHERE id = $2', ['approved', orderId]);
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// 拒绝充值订单
app.post('/api/admin/reject_recharge', adminAuth, async (req, res) => {
    const { orderId } = req.body;
    await pool.query('UPDATE recharge_orders SET status = $1, updated_at = NOW() WHERE id = $2', ['rejected', orderId]);
    res.json({ success: true });
});

// 获取提现订单列表
app.get('/api/admin/withdraw_orders', adminAuth, async (req, res) => {
    const { rows } = await pool.query(`
        SELECT o.*, u.account FROM withdraw_orders o
        JOIN users u ON o.user_id = u.id
        WHERE o.status = 'pending'
        ORDER BY o.created_at DESC
    `);
    res.json(rows);
});

// 审核提现（通过，扣除用户余额，标记完成）
app.post('/api/admin/approve_withdraw', adminAuth, async (req, res) => {
    const { orderId } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const orderRes = await client.query('SELECT user_id, amount FROM withdraw_orders WHERE id = $1 FOR UPDATE', [orderId]);
        if (!orderRes.rows.length) throw new Error('订单不存在');
        const order = orderRes.rows[0];
        const userRes = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [order.user_id]);
        if (userRes.rows[0].balance < order.amount) throw new Error('用户余额不足');
        await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [order.amount, order.user_id]);
        await client.query('UPDATE withdraw_orders SET status = $1, updated_at = NOW() WHERE id = $2', ['approved', orderId]);
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// 拒绝提现
app.post('/api/admin/reject_withdraw', adminAuth, async (req, res) => {
    const { orderId } = req.body;
    await pool.query('UPDATE withdraw_orders SET status = $1, updated_at = NOW() WHERE id = $2', ['rejected', orderId]);
    res.json({ success: true });
});

// 调整庄家余额、抽水系数
app.post('/api/admin/config', adminAuth, async (req, res) => {
    const { banker_balance, adjust_factor } = req.body;
    if (banker_balance !== undefined) await updatePlatformConfig('banker_balance', banker_balance);
    if (adjust_factor !== undefined) await updatePlatformConfig('adjust_factor', adjust_factor);
    res.json({ success: true });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});


