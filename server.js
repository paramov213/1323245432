const express = require('express');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// --- КОНФИГУРАЦИЯ ---
const apiId = 1234567; // ВСТАВЬ СВОЙ API_ID
const apiHash = "твой_api_hash"; // ВСТАВЬ СВОЙ API_HASH
let stringSession = new StringSession(""); // Пустая строка для начала
// --------------------

let client;

app.post('/api/send-code', async (req, res) => {
    const { phoneNumber } = req.body;
    try {
        client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
        await client.connect();
        
        const { phoneCodeHash } = await client.sendCode({ apiId, apiHash }, phoneNumber);
        res.json({ success: true, phoneCodeHash });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/login', async (req, res) => {
    const { phoneNumber, phoneCode, phoneCodeHash } = req.body;
    try {
        await client.signIn({
            phoneNumber,
            phoneCode: async () => phoneCode,
            phoneCodeHash,
            onError: (err) => console.log(err),
        });
        
        const savedSession = client.session.save();
        console.log("ВАША СЕССИЯ (СОХРАНИТЕ ЕЁ):", savedSession);
        // В продакшене эту строку нужно сохранить в БД или .env
        res.json({ success: true, session: savedSession });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/dialogs', async (req, res) => {
    try {
        const dialogs = await client.getDialogs({});
        const chatList = dialogs.map(d => ({
            id: d.id,
            title: d.title || d.entity.firstName || "Unknown",
            lastMessage: d.message.message,
            unreadCount: d.unreadCount
        }));
        res.json(chatList);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));