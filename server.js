const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const { startTunnel } = require('untun');

const PORT = parseInt(process.env.PORT || '8765', 10);
const rooms = new Map(); // roomCode -> [ { id, name, text, time } ]
const wsClients = new Map(); // roomCode -> Set<WebSocket>

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function getMessages(room) {
  const code = (room || 'general').trim().toLowerCase();
  if (!rooms.has(code)) rooms.set(code, []);
  return rooms.get(code);
}

function broadcast(room, msg) {
  const code = (room || 'general').trim().toLowerCase();
  const clients = wsClients.get(code);
  if (!clients) return;
  const payload = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Send message
app.post('/api/rooms/:room/messages', (req, res) => {
  const { name, text } = req.body;
  if (!name || !text) {
    return res.status(400).json({ error: 'name and text are required' });
  }

  const room = req.params.room.trim().toLowerCase();
  const msgs = getMessages(room);
  const msg = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    room,
    name: name.trim(),
    text: String(text).trim(),
    time: Date.now(),
  };

  msgs.push(msg);
  if (msgs.length > 500) msgs.shift();

  broadcast(room, msg);
  res.json(msg);
});

// Read messages
app.get('/api/rooms/:room/messages', (req, res) => {
  const room = req.params.room.trim().toLowerCase();
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const msgs = getMessages(room);
  res.json(msgs.slice(-limit));
});

// WebSocket live streaming
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const room = (url.searchParams.get('room') || 'general').trim().toLowerCase();

  if (!wsClients.has(room)) wsClients.set(room, new Set());
  const clients = wsClients.get(room);
  clients.add(ws);

  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

async function startServer(enableTunnel = false) {
  return new Promise((resolve) => {
    server.listen(PORT, async () => {
      const localUrl = `http://localhost:${PORT}`;
      let publicUrl = null;

      if (enableTunnel) {
        try {
          const tunnel = await startTunnel({ port: PORT, acceptCloudflareNotice: true });
          publicUrl = (await tunnel.getURL()).replace(/\/$/, '');
        } catch (err) {
          console.error('Tunnel warning:', err.message);
        }
      }

      resolve({ localUrl, publicUrl });
    });
  });
}

if (require.main === module) {
  const enableTunnel = process.argv.includes('--public');
  startServer(enableTunnel).then(({ localUrl, publicUrl }) => {
    console.log(`\n📡 Room Server running!`);
    console.log(`Local:  ${localUrl}`);
    if (publicUrl) console.log(`Public: ${publicUrl}  <-- Share with your team`);
    console.log();
  });
}

module.exports = { startServer, app };
