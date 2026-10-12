const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

let slots = {
    1: { active: true, proxies: [] },
    2: { active: true, proxies: [] },
    3: { active: true, proxies: [] }
};

let clients = [];

app.get('/api/status', (req, res) => {
    // حساب المتصفحات التي أرسلت هويتها فقط
    const activeClients = clients.filter(client => client.readyState === 1 && client.browserId);
    res.json({
        connectedBrowsers: activeClients.length,
        slots: slots
    });
});

function distributeProxies() {
    const activeClients = clients.filter(client => client.readyState === 1 && client.browserId);
    if (activeClients.length === 0) return;

    let clientsPayload = activeClients.map(() => []);

    for (let i = 1; i <= 3; i++) {
        if (slots[i].active && slots[i].proxies.length > 0) {
            const slotProxies = slots[i].proxies;
            const chunkSize = Math.ceil(slotProxies.length / activeClients.length);
            
            activeClients.forEach((client, index) => {
                const chunk = slotProxies.slice(index * chunkSize, (index + 1) * chunkSize);
                clientsPayload[index] = clientsPayload[index].concat(chunk);
            });
        }
    }

    activeClients.forEach((client, index) => {
        try {
            client.send(JSON.stringify({ type: 'UPDATE_PROXIES', proxies: clientsPayload[index] }));
        } catch (e) {}
    });
}

wss.on('connection', (ws) => {
    ws.isAlive = true;
    clients.push(ws);
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'INIT') {
                // إذا وجد السيرفر اتصالاً قديماً يحمل نفس هوية هذا المتصفح، سيقوم بقتله فوراً
                const oldConnections = clients.filter(c => c.browserId === data.id && c !== ws);
                oldConnections.forEach(oldWs => {
                    try { oldWs.terminate(); } catch(e) {}
                });
                
                // تنظيف المصفوفة من الاتصالات الميتة
                clients = clients.filter(c => c.browserId !== data.id || c === ws);
                ws.browserId = data.id; // تثبيت هوية المتصفح الجديد
                ws.isAlive = true;
                distributeProxies();
            } 
            else if (data.type === 'PING') {
                ws.isAlive = true; 
            }
        } catch(e) {}
    });

    ws.on('close', () => {
        clients = clients.filter(client => client !== ws && client.readyState === 1);
        distributeProxies();
    });
    
    ws.on('error', () => {
        ws.isAlive = false;
    });
});

setInterval(() => {
    let needsUpdate = false;
    clients.forEach((ws) => {
        if (ws.isAlive === false) {
            try { ws.terminate(); } catch(e) {}
            needsUpdate = true;
        }
        ws.isAlive = false; 
    });

    if (needsUpdate) {
        clients = clients.filter(client => client.readyState === 1 && client.browserId);
        distributeProxies();
    }
}, 30000);

app.post('/api/update-slot', (req, res) => {
    const { slotId, proxies, isActive } = req.body;
    if (slots[slotId]) {
        slots[slotId].proxies = proxies || slots[slotId].proxies;
        slots[slotId].active = isActive !== undefined ? isActive : slots[slotId].active;
        clients = clients.filter(client => client.readyState === 1 && client.browserId);
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
