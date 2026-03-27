<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no,viewport-fit=cover">
    <title>TITAN_JILI_V30000</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        :root { --neon: #00f2ff; --green: #00ff88; --dark-green: #006633; --pink: #ff0055; --gold: #ffcc00; }
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; margin:0; padding:0; }
        body { background: #000; color: #fff; font-family: 'Arial Black', sans-serif; height: 100vh; overflow: hidden; }

        /* 1. 背景：十万级炫彩粒子流光 */
        #bg-canvas { position: fixed; inset: 0; z-index: 1; pointer-events: none; }
        .ui-root { position: relative; z-index: 10; height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: space-between; }

        /* 2. 顶部：钻石发光余额 (深度拟物) */
        .header { margin-top: 40px; background: linear-gradient(180deg, #222, #000); border: 3px solid var(--neon); padding: 12px 60px; border-radius: 18px; box-shadow: 0 0 40px var(--neon), inset 0 0 15px var(--neon); display: flex; align-items: center; gap: 15px; }
        .bal-val { font-size: 65px; font-weight: 900; text-shadow: 0 0 20px var(--neon); letter-spacing: -2px; }

        /* 3. 转盘：机械精密包边 (解决不突出问题) */
        .stage { position: relative; width: 92vw; max-width: 420px; aspect-ratio: 1/1; display: flex; align-items: center; justify-content: center; }
        .needle { position: absolute; top: -15px; width: 6px; height: 75px; background: #fff; box-shadow: 0 0 30px #fff; z-index: 100; border-radius: 3px; }

        .disk {
            width: 100%; height: 100%; border-radius: 50%;
            background: radial-gradient(circle, #333 0%, #000 80%);
            border: 5px solid #444; position: relative; overflow: hidden;
            box-shadow: 0 20px 60px rgba(0,0,0,1), inset 0 0 120px rgba(0,242,255,0.25);
            transition: transform 6.8s cubic-bezier(0.1, 0, 0, 1);
        }
        .item { position: absolute; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; transform-origin: center; }
        .item b { position: absolute; top: 10%; font-size: 92px; filter: drop-shadow(0 10px 15px #000); }

        /* 🟢 JILI 风格 3D 绿色实体大按钮 (核心触感) */
        .spin-btn {
            position: absolute; width: 135px; height: 135px; border-radius: 50%;
            background: linear-gradient(180deg, var(--green) 0%, var(--dark-green) 100%);
            border: 8px solid #004422; color: #fff; font-size: 28px; font-weight: 900;
            display: flex; align-items: center; justify-content: center; z-index: 200;
            box-shadow: 0 12px 0 #002211, 0 25px 50px rgba(0,0,0,0.9);
            cursor: pointer; transition: 0.1s; text-shadow: 0 2px 5px #000;
        }
        .spin-btn:active { transform: translateY(10px); box-shadow: 0 2px 0 #002211; }

        /* 4. 底部：重金属控制台 (解决按键不明显) */
        .panel {
            background: linear-gradient(180deg, #2a2a2a 0%, #000 100%);
            width: 100%; padding: 35px 0 55px; border-top: 5px solid #383838;
            display: flex; flex-direction: column; align-items: center;
            box-shadow: 0 -25px 60px rgba(0,0,0,0.9);
        }
        #msg { font-size: 32px; font-weight: 900; color: var(--gold); letter-spacing: 5px; text-shadow: 0 0 20px var(--gold); margin-bottom: 25px; }
        
        .ctrl-row { display: flex; align-items: center; gap: 60px; }
        
        /* 🔘 拟物化 3D 加减键 (白色高亮实体) */
        .btn-adj {
            width: 95px; height: 95px; border-radius: 18px;
            background: linear-gradient(180deg, #666, #222);
            border: 3px solid #777; color: #fff; font-size: 70px;
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 10px 0 #000, 0 15px 30px rgba(0,0,0,0.8);
            cursor: pointer; transition: 0.1s; font-weight: 100;
        }
        .btn-adj:active { transform: translateY(6px); box-shadow: 0 2px 0 #000; color: var(--neon); }
        .bet-val { font-size: 110px; font-weight: 900; min-width: 180px; text-align: center; color: #fff; text-shadow: 0 0 30px rgba(255,255,255,0.3); }

        /* 震撼视觉：DJ 重低音共振 */
        .shake-ui { animation: bass-boom 0.05s infinite; filter: brightness(1.6) contrast(1.4); }
        @keyframes bass-boom { 0%{transform:translate(4px,4px)} 50%{transform:translate(-4px,-4px)} }
    </style>
</head>
<body onclick="wakeUp()">
    <canvas id="bg-canvas"></canvas>
    <div class="ui-root" id="main-ui">
        <div class="header">
            <div style="font-size:55px">💎</div>
            <div class="bal-val" id="bal">1,000</div>
        </div>
        <div class="stage">
            <div class="needle"></div>
            <div id="disk" class="disk">
                <div class="item" style="transform:rotate(0deg)"><b>👑</b></div>
                <div class="item" style="transform:rotate(60deg)"><b>🦁</b></div>
                <div class="item" style="transform:rotate(120deg)"><b>🐯</b></div>
                <div class="item" style="transform:rotate(180deg)"><b>🦅</b></div>
                <div class="item" style="transform:rotate(240deg)"><b>🐺</b></div>
                <div class="item" style="transform:rotate(300deg)"><b>🐕</b></div>
            </div>
            <div class="spin-btn" onclick="ignite()">SPIN</div>
        </div>
        <div class="panel">
            <div id="msg">TITAN_SYSTEM_READY</div>
            <div class="ctrl-row">
                <div class="btn-adj" onclick="adj(-10)">-</div>
                <div class="bet-val" id="bet">1</div>
                <div class="btn-adj" onclick="adj(10)">+</div>
            </div>
        </div>
    </div>
    <script>
        const tg = window.Telegram.WebApp; tg.expand();
        let balance = 1000, bet = 1, rot = 0, active = false, audio;
        function wakeUp() {
            if(audio) return;
            audio = new (window.AudioContext || window.webkitAudioContext)();
            const cvs = document.getElementById('bg-canvas');
            const ctx = cvs.getContext('2d');
            cvs.width = window.innerWidth; cvs.height = window.innerHeight;
            let p = [];
            for(let i=0; i<120; i++) p.push({x:Math.random()*cvs.width, y:Math.random()*cvs.height, s:Math.random()*2.5, c:`hsl(${Math.random()*360}, 100%, 75%)`});
            function draw() {
                ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(0,0,cvs.width, cvs.height);
                p.forEach(a => {
                    a.y += active ? 45 : 1.8; if(a.y > cvs.height) a.y = -30;
                    ctx.fillStyle = active ? '#fff' : a.c;
                    ctx.beginPath(); ctx.arc(a.x, a.y, active?a.s*3:a.s, 0, Math.PI*2); ctx.fill();
                    if(active) { ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(a.x,a.y-60); ctx.stroke(); }
                });
                requestAnimationFrame(draw);
            }
            draw();
        }
        function playBass(d) {
            if(!audio) return;
            const osc = audio.createOscillator(); const g = audio.createGain();
            osc.type = 'sawtooth'; osc.frequency.setValueAtTime(45, audio.currentTime);
            osc.frequency.exponentialRampToValueAtTime(15, audio.currentTime + d);
            g.gain.setValueAtTime(0.6, audio.currentTime); g.gain.linearRampToValueAtTime(0, audio.currentTime + d);
            osc.connect(g); g.connect(audio.destination); osc.start(); osc.stop(audio.currentTime + d);
        }
        function adj(v) {
            if(active) return;
            bet = Math.max(1, Math.min(balance, bet + v));
            document.getElementById('bet').innerText = bet;
            tg.HapticFeedback.selectionChanged();
        }
        function ignite() {
            if(active || balance < bet) return;
            active = true; balance -= bet;
            document.getElementById('bal').innerText = balance.toLocaleString();
            document.getElementById('main-ui').classList.add('shake-ui');
            document.getElementById('msg').innerText = "BASS_OVERLOAD_IGNITION";
            playBass(6.8); tg.HapticFeedback.impactOccurred('heavy');
            let target = Math.floor(Math.random()*6);
            rot += (3600 + (360 - (target * 60)));
            document.getElementById('disk').style.transform = `rotate(${rot}deg)`;
            setTimeout(() => {
                document.getElementById('main-ui').classList.remove('shake-ui');
                const multi = [88, 15, 10, 5, 2, 0];
                let win = Math.floor(bet * multi[target]);
                balance += win;
                document.getElementById('bal').innerText = balance.toLocaleString();
                document.getElementById('msg').innerText = win > 0 ? "WIN: +" + win : "CORE_LOST";
                tg.HapticFeedback.notificationOccurred(win > 0 ? 'success' : 'error');
                active = false;
            }, 6800);
        }
    </script>
</body>
</html>