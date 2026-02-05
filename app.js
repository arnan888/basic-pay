// 生成随机订单号
const orderId = 'USDT-' + Date.now();
const amount = (Math.random() * 10 + 1).toFixed(2);

// 模拟 USDT 地址（以后可换成真地址）
const address = 'TX' + Math.random().toString(36).substring(2, 10);

// 页面加载时填充内容
document.getElementById('orderId').innerText = orderId;
document.getElementById('amount').innerText = amount;
document.getElementById('address').innerText = address;

// 点击按钮后的行为
function startPayment() {
  document.getElementById('status').innerText = '已提交，等待区块确认中 ⏳';
}
