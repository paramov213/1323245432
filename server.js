const express = require('express');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input'); // Для терминального ввода, если нужно, но мы сделаем через UI
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const port = 3000;

// ВСТАВЬ СВОИ ДАННЫЕ СЮДА
const apiId = 26171312; // Замени на свой api_id
const apiHash = '003eb0ddc813d5d5f5ba6f80c0cab364';
let sessionString = ""; // Здесь будет храниться строка сессии после логина

app.use(bodyParser.json());
app.use(express.static('public'));

let client;

// Инициализация клиента
async function initClient(string) {
    client = new TelegramClient(new StringSession(string), apiId, apiHash, {
        connectionRetries: 5,
    });
}

// Эндпоинт для отправки кода
app.post('/api/send-code', async (req, res) => {
    const { phone } = req.body;
    try {
        await initClient(""); // Начинаем с чистой сессии
        await client.connect();
        const { phoneCodeHash } = await client.sendCode({ apiId, apiHash }, phone);
        res.json({ success: true, phoneCodeHash });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Эндпоинт для подтверждения кода
app.post('/api/login', async (req, res) => {
    const { phone, code, phoneCodeHash } = req.body;
    try {
        await client.signInUser({ apiId, apiHash }, {
            phoneNumber: phone,
            phoneCode: code,
            phoneCodeHash: phoneCodeHash,
            onError: (err) => console.log(err),
        });
        sessionString = client.session.save(); // Сохраняем сессию
        res.json({ success: true, session: sessionString });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Получение диалогов
app.get('/api/dialogs', async (req, res) => {
    try {
        const dialogs = await client.getDialogs({});
        const results = dialogs.map(d => ({
            id: d.id.toString(),
            title: d.title,
            lastMessage: d.message?.message || "Media/Service message",
            unreadCount: d.unreadCount
        }));
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
