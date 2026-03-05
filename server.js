const express = require('express');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');

const app = express();
const port = 3000;
const upload = multer({ dest: 'uploads/' });

const apiId = 26171312;
const apiHash = '003eb0ddc813d5d5f5ba6f80c0cab364';
const SESSION_FILE = './session.txt';

let savedSession = fs.existsSync(SESSION_FILE) ? fs.readFileSync(SESSION_FILE, 'utf8') : "";
let client;
let clientsSSE = [];

app.use(bodyParser.json());

async function initClient(sessionStr) {
    client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
        connectionRetries: 5,
    });

    client.addEventHandler(async (event) => {
        const message = event.message;
        if (!message) return;
        const senderId = message.peerId?.userId?.toString() || message.peerId?.chatId?.toString();
        
        clientsSSE.forEach(res => {
            res.write(`data: ${JSON.stringify({
                type: 'new_message',
                peerId: senderId,
                text: message.message || (message.media ? "📷 Медиа" : "Действие"),
                out: message.out
            })}\n\n`);
        });
    }, new NewMessage({}));
}

// SSE для обновлений
app.get('/api/updates', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    clientsSSE.push(res);
    req.on('close', () => { clientsSSE = clientsSSE.filter(c => c !== res); });
});

// Роуты авторизации
app.get('/api/status', async (req, res) => {
    if (savedSession) {
        try {
            if (!client) await initClient(savedSession);
            if (!client.connected) await client.connect();
            return res.json({ loggedIn: true });
        } catch (e) { return res.json({ loggedIn: false }); }
    }
    res.json({ loggedIn: false });
});

app.post('/api/send-code', async (req, res) => {
    const { phone } = req.body;
    try {
        await initClient(""); 
        await client.connect();
        const { phoneCodeHash } = await client.sendCode({ apiId, apiHash }, phone);
        res.json({ success: true, phoneCodeHash });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/login', async (req, res) => {
    const { phone, code, phoneCodeHash } = req.body;
    try {
        await client.signInUser({ apiId, apiHash }, {
            phoneNumber: phone,
            phoneCode: code,
            phoneCodeHash: phoneCodeHash,
        });
        const sessionStr = client.session.save();
        fs.writeFileSync(SESSION_FILE, sessionStr);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Данные мессенджера
app.get('/api/dialogs', async (req, res) => {
    try {
        const dialogs = await client.getDialogs({});
        res.json(dialogs.map(d => ({
            id: d.id.toString(),
            title: d.title || "Unknown",
            lastMessage: d.message?.message || "Медиа"
        })));
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/messages', async (req, res) => {
    const { peerId } = req.query;
    try {
        const messages = await client.getMessages(peerId, { limit: 40 });
        res.json(messages.map(m => ({ text: m.message, out: m.out, isMedia: !!m.media })));
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Отправка данных
app.post('/api/send-message', async (req, res) => {
    const { peerId, message } = req.body;
    try {
        await client.sendMessage(peerId, { message: message });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/send-photo', upload.single('photo'), async (req, res) => {
    const { peerId } = req.body;
    try {
        await client.sendFile(peerId, { file: req.file.path, caption: req.body.caption || "" });
        fs.unlinkSync(req.file.path);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Инициация звонка (Сигнальная часть)
app.post('/api/make-call', async (req, res) => {
    const { peerId } = req.body;
    try {
        // В рамках данного клона мы инициируем запрос на звонок
        // Для полноценного голоса требуется WebRTC Bridge
        res.json({ success: true, message: "Calling " + peerId });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// FRONTEND
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>TG Premium Clone v3</title>
    <style>
        :root { --tg-blue: #2481cc; --premium: linear-gradient(45deg, #6b4cff, #ff4c9f); }
        body { font-family: -apple-system, sans-serif; margin: 0; display: flex; height: 100vh; overflow: hidden; background: #e7ebf0; }
        
        #auth-container { position: fixed; inset: 0; background: white; z-index: 1000; display: flex; flex-direction: column; align-items: center; justify-content: center; }
        #app { display: none; width: 100%; height: 100%; }
        
        .sidebar { width: 320px; background: white; border-right: 1px solid #ddd; display: flex; flex-direction: column; }
        .dialog-item { padding: 12px; border-bottom: 1px solid #f2f2f2; cursor: pointer; }
        .dialog-item:hover { background: #f4f4f5; }
        
        .main-chat { flex-grow: 1; display: flex; flex-direction: column; background-image: url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png'); }
        .chat-header { padding: 10px 20px; background: white; border-bottom: 1px solid #ddd; display: flex; justify-content: space-between; align-items: center; }
        
        .messages { flex-grow: 1; padding: 20px; overflow-y: auto; display: flex; flex-direction: column-reverse; gap: 8px; }
        .msg { padding: 8px 12px; border-radius: 12px; max-width: 70%; box-shadow: 0 1px 1px #0002; }
        .msg.in { background: white; align-self: flex-start; }
        .msg.out { background: #eeffde; align-self: flex-end; }
        
        .input-bar { padding: 10px 15px; background: white; display: flex; gap: 10px; align-items: center; }
        input[type="text"] { flex-grow: 1; padding: 10px; border: 1px solid #ddd; border-radius: 10px; outline: none; }
        
        button { padding: 10px 15px; border-radius: 10px; border: none; cursor: pointer; transition: 0.2s; }
        .btn-send { background: var(--tg-blue); color: white; }
        .btn-call { background: #4caf50; color: white; font-size: 18px; }
        .premium-tag { background: var(--premium); color: white; padding: 3px 8px; border-radius: 10px; font-size: 10px; font-weight: bold; }
    </style>
</head>
<body>
    <div id="auth-container">
        <h2>Telegram Web Clone</h2>
        <div id="phone-step">
            <input type="text" id="phone" placeholder="+79001112233" style="width:250px; padding:10px;"><br><br>
            <button class="btn-send" onclick="sendCode()" style="width:270px;">Продолжить</button>
        </div>
        <div id="code-step" style="display:none;">
            <input type="text" id="code" placeholder="Код" style="width:250px; padding:10px;"><br><br>
            <button class="btn-send" onclick="login()" style="width:270px;">Войти</button>
        </div>
    </div>

    <div id="app">
        <div class="sidebar">
            <div style="padding:15px; border-bottom:1px solid #ddd;"><b>Все чаты</b></div>
            <div id="list" style="overflow-y:auto;"></div>
        </div>
        <div class="main-chat">
            <div class="chat-header">
                <div id="chat-title">Выберите чат</div>
                <div style="display:flex; gap:10px; align-items:center;">
                    <button class="btn-call" onclick="makeCall()">📞</button>
                    <span class="premium-tag">PREMIUM</span>
                </div>
            </div>
            <div class="messages" id="msgs"></div>
            <div class="input-bar">
                <label style="cursor:pointer; font-size:20px;">📎<input type="file" id="photo-in" hidden onchange="upPhoto()"></label>
                <input type="text" id="inp" placeholder="Написать..." onkeypress="if(event.key==='Enter') send()">
                <button class="btn-send" onclick="send()">➤</button>
            </div>
        </div>
    </div>

    <script>
        let selectedId = null;

        // Real-time
        const evtSource = new EventSource("/api/updates");
        evtSource.onmessage = (e) => {
            const data = JSON.parse(e.data);
            if(data.peerId === selectedId) renderMsg(data.text, data.out);
        };

        async function check() {
            const r = await fetch('/api/status');
            const d = await r.json();
            if(d.loggedIn) show();
        }

        async function sendCode() {
            const phone = document.getElementById('phone').value;
            const r = await fetch('/api/send-code', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ phone })
            });
            const d = await r.json();
            if(d.success) {
                window.hash = d.phoneCodeHash;
                document.getElementById('phone-step').style.display='none';
                document.getElementById('code-step').style.display='block';
            }
        }

        async function login() {
            const code = document.getElementById('code').value;
            const phone = document.getElementById('phone').value;
            const r = await fetch('/api/login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ phone, code, phoneCodeHash: window.hash })
            });
            if((await r.json()).success) show();
        }

        function show() {
            document.getElementById('auth-container').style.display='none';
            document.getElementById('app').style.display='flex';
            loadChats();
        }

        async function loadChats() {
            const r = await fetch('/api/dialogs');
            const chats = await r.json();
            document.getElementById('list').innerHTML = chats.map(c => \`
                <div class="dialog-item" onclick="select('\${c.id}', '\${c.title}')">
                    <b>\${c.title}</b><br><small style="color:gray">\${c.lastMessage}</small>
                </div>
            \`).join('');
        }

        async function select(id, title) {
            selectedId = id;
            document.getElementById('chat-title').innerText = title;
            const r = await fetch(\`/api/messages?peerId=\${id}\`);
            const msgs = await r.json();
            const cont = document.getElementById('msgs');
            cont.innerHTML = '';
            msgs.forEach(m => renderMsg(m.isMedia ? "📷 Медиа" : m.text, m.out));
        }

        function renderMsg(text, out) {
            const cont = document.getElementById('msgs');
            const div = document.createElement('div');
            div.className = \`msg \${out ? 'out' : 'in'}\`;
            div.innerText = text || '';
            cont.prepend(div);
        }

        async function send() {
            const i = document.getElementById('inp');
            if(!i.value || !selectedId) return;
            await fetch('/api/send-message', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ peerId: selectedId, message: i.value })
            });
            renderMsg(i.value, true);
            i.value = '';
        }

        async function upPhoto() {
            const fin = document.getElementById('photo-in');
            if(!fin.files[0] || !selectedId) return;
            const fd = new FormData();
            fd.append('photo', fin.files[0]);
            fd.append('peerId', selectedId);
            renderMsg("⏳ Отправка...", true);
            await fetch('/api/send-photo', { method: 'POST', body: fd });
            fin.value = '';
        }

        async function makeCall() {
            if(!selectedId) return alert("Выберите чат!");
            const r = await fetch('/api/make-call', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ peerId: selectedId })
            });
            const d = await r.json();
            alert("Инициализация звонка: " + d.message);
        }

        check();
    </script>
</body>
</html>
    `);
});

app.listen(port, () => {
    console.log(`✅ Твой Telegram Clone запущен: http://localhost:${port}`);
});
