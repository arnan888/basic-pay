<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
    <title>TITAN_BASS_V30007</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        :root { --gold: #ffcc00; --win: #00ff88; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #000; color: #fff; font-family: 'Arial Black', sans-serif; height: 100vh; overflow: hidden; display: flex; flex-direction: column; align-items: center; justify-content: space-around; }
        .header { background: rgba(0,0,0,0.8); border: 2px solid var(--gold); padding: 10px 40px; border-radius: 50px; box-shadow: 0 0 20px rgba(255,204,0,0.6); }
        #balance { font-size: 45px; color: var(--gold); text-shadow: 0 0 15px gold; }
        
        /* 🎡 核心转盘区 */
        .slot-container {
            width: 280px; height: 280px; background: radial-gradient(circle, #222, #000);
            border: 10px solid #333; border-radius: 50%; position: relative;
            display: flex; align-items: center; justify-content: center; overflow: hidden;
            box-shadow: 0 0 60px rgba(0,255,136,0.3);
        }
        .slot-reel { font-size: 120px; transition: 0.3s; }
        .spin-btn {
            position: absolute; width: 110px; height: 110px; border-radius: 50%;
            background: radial-gradient(circle, #00ff88, #006633); border: 5px solid #004422;
            color: #fff; font-size: 24px; font-weight: 900; z-index: 100;
            box-shadow: 0 10px 0 #003311, 0 15px 30px rgba(0,255,136,0.6); cursor: pointer;
        }
        .spin-btn:active { transform: translateY(6px); box-shadow: 0 4px 0 #003311; }
        
        .footer { width: 95%; background: #111; padding: 25px; border-radius: 25px; display: flex; justify-content: space-between; align-items: center; border: 1px solid #333; }
        .btn-mini { width: 55px; height: 55px; background: #444; color: #fff; border: none; border-radius: 12px; font-size: 28px; }

        /* 旋转动效 */
        @keyframes blur-spin { 0% { filter: blur(0); } 50% { filter: blur(10px); } 100% { filter: blur(0); } }
        .spinning { animation: blur-spin 0.2s infinite; }
    </style>
</head>
<body>
    <!-- 音效资源 -->
    <audio id="bgm" src="https://www.soundjay.com/free-music/iron-man-1.mp3" loop>
    <audio id="spin-sound" src="https://www.soundjay.com/mechanical/mechanical-clanking-1.mp3">
    <audio id="win-sound" src="https://www.soundjay.com/misc/coins-spilled-1.mp3">

    <div class="header">
        <div id="balance">0</div>
    </div>

    <div class="slot-container">
        <button class="spin-btn" id="btn" onclick="handleStart()">SPIN</button>
        <div class="slot-reel" id="reel">🦁</div>
    </div>

    <div class="footer">
        <div style="display:flex; align-items:center; gap:15px;">
            <button class="btn-mini" onclick="changeBet(-50)">-</button>
            <span id="bet-val" style="font-size:32px; color:var(--gold);">100</span>
            <button class="btn-mini" onclick="changeBet(50)">+</button>
        </div>
        <div style="color:var(--win); font-size:26px;">WIN: <span id="win-amt">0</span></div>
    </div>

    <script>
        const symbols = ['🦁', '🐯', '🐻', '🦅', '💎', '7️⃣'];
        const urlParams = new URLSearchParams(window.location.search);
        let balance = parseInt(urlParams.get('balance')) || 8888;
        let bet = 100;
        let isFirstClick = true;
        const tg = window.Telegram.WebApp;
        tg.expand();

        document.getElementById('balance').innerText = balance.toLocaleString();

        function handleStart() {
            // 第一次点击激活音频（解决浏览器限制）
            if(isFirstClick) {
                document.getElementById('bgm').play().catch(e => console.log("等待交互"));
                isFirstClick = false;
            }
            startSpin();
        }

        function changeBet(amt) {
            if(bet + amt >= 50) bet += amt;
            document.getElementById('bet-val').innerText = bet;
            tg.HapticFeedback.impactOccurred('light');
        }

        function startSpin() {
            if(balance < bet) { tg.showAlert("余额不足！"); return; }
            
            // 扣钱 + 声音
            balance -= bet;
            document.getElementById('balance').innerText = balance.toLocaleString();
            document.getElementById('spin-sound').play();
            
            const reel = document.getElementById('reel');
            const btn = document.getElementById('btn');
            
            reel.classList.add('spinning');
            btn.disabled = true;
            tg.HapticFeedback.impactOccurred('heavy');

            // 模拟旋转 1 秒
            setTimeout(() => {
                reel.classList.remove('spinning');
                const result = symbols[Math.floor(Math.random() * symbols.length)];
                reel.innerText = result;
                
                let win = 0;
                if(result === '💎') win = bet * 20;
                else if(result === '7️⃣') win = bet * 10;
                else if(Math.random() > 0.6) win = bet * 3;

                if(win > 0) {
                    balance += win;
                    document.getElementById('win-amt').innerText = win;
                    document.getElementById('win-sound').play();
                    tg.HapticFeedback.notificationOccurred('success');
                } else {
                    document.getElementById('win-amt').innerText = 0;
                }
                
                document.getElementById('balance').innerText = balance.toLocaleString();
                btn.disabled = false;
            }, 1000);
        }
    </script>
</body>
</html>