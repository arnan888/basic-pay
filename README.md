<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>支付页面</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      background: #f5f6f8;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
    }

    .card {
      background: #ffffff;
      padding: 30px;
      border-radius: 12px;
      width: 320px;
      text-align: center;
      box-shadow: 0 10px 30px rgba(0,0,0,0.1);
    }

    h1 {
      margin-top: 0;
    }

    .price {
      font-size: 24px;
      color: #e53935;
      margin: 20px 0;
    }

    button {
      background: #4CAF50;
      color: white;
      border: none;
      padding: 12px 20px;
      font-size: 16px;
      border-radius: 8px;
      cursor: pointer;
      width: 100%;
    }

    button:hover {
      background: #43a047;
    }
  </style>
</head>
<body>

  <div class="card">
    <h1>支付系统已上线</h1>
    <p>这是测试支付页面</p>
    <div class="price">￥99.00</div>
    <button>立即支付</button>
  </div>

</body>
</html>
