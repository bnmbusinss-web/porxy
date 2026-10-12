const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

let slots = {
    1: { active: true, proxies: [] },
    2: { active: true, proxies: [] },
    3: { active: true, proxies: [] }
};

let clients = [];

// --- هذا هو الجزء الجديد لإرسال حالة الخادم والبروكسيات المحفوظة ---
app.get('/api/status', (req, res) => {
    res.json({
        connectedBrowsers: clients.length,
        slots: slots
    });
});
// ------------------------------------------------------------------

function distributeProxies() {
    if (clients.length === 0) return;

    let clientsPayload = clients.map(() => []);

    for (let i = 1; i <= 3; i++) {
        if (slots[i].active && slots[i].proxies.length > 0) {
            const slotProxies = slots[i].proxies;
            const chunkSize = Math.ceil(slotProxies.length / clients.length);
            
            clients.forEach((client, index) => {
                const chunk = slotProxies.slice(index * chunkSize, (index + 1) * chunkSize);
                clientsPayload[index] = clientsPayload[index].concat(chunk);
            });
        }
    }

    clients.forEach((client, index) => {
        if (client.readyState === 1) { 
            client.send(JSON.stringify({ type: 'UPDATE_PROXIES', proxies: clientsPayload[index] }));
        }
    });
}

wss.on('connection', (ws) => {
    clients.push(ws);
    console.log(`متصفح متصل. العدد: ${clients.length}`);
    distributeProxies();

    ws.on('close', () => {
        clients = clients.filter(client => client !== ws);
        console.log(`متصفح غادر. العدد: ${clients.length}`);
        distributeProxies();
    });
});

app.post('/api/update-slot', (req, res) => {
    const { slotId, proxies, isActive } = req.body;
    if (slots[slotId]) {
        slots[slotId].proxies = proxies || slots[slotId].proxies;
        slots[slotId].active = isActive !== undefined ? isActive : slots[slotId].active;
        distributeProxies();
        res.json({ success: true, connectedBrowsers: clients.length });
    } else {
        res.status(400).json({ error: 'خانة غير صالحة' });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
