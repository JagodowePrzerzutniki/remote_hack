const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const { startTunnel } = require('untun');

const PORT = parseInt(process.env.PORT || '8765', 10);
const AFK_TIMEOUT_MS = 60 * 1000; // 1 minute without heartbeat = auto AFK

// In-memory data store per room
// rooms[roomCode] = { messages: [], members: { [name]: { name, afk, afkReason, lastSeen } } }
const rooms = new Map();

function getRoom(code) {
  const cleanCode = (code || 'default').trim().toLowerCase();
  if (!rooms.has(cleanCode)) {
    rooms.set(cleanCode, {
      messages: [],
      members: new Map(),
    });
  }
  return rooms.get(cleanCode);
}

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// WebSocket connections by room
// wsClients[roomCode] = Set<WebSocket>
const wsClients = new Map();

function broadcastToRoom(roomCode, data) {
  const cleanCode = roomCode.trim().toLowerCase();
  const clients = wsClients.get(cleanCode);
  if (!clients) return;
  const payload = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

// REST API

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', roomsCount: rooms.size });
});

// Join room / register name
app.post('/api/rooms/:room/join', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const room = getRoom(req.params.room);
  const cleanName = name.trim();
  const member = {
    name: cleanName,
    afk: false,
    afkReason: '',
    lastSeen: Date.now(),
  };
  room.members.set(cleanName, member);

  broadcastToRoom(req.params.room, {
    type: 'MEMBER_JOIN',
    room: req.params.room,
    member,
  });

  res.json({ ok: true, member });
});

// Heartbeat
app.post('/api/rooms/:room/heartbeat', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const room = getRoom(req.params.room);
  const cleanName = name.trim();
  const member = room.members.get(cleanName) || {
    name: cleanName,
    afk: false,
    afkReason: '',
    lastSeen: Date.now(),
  };

  member.lastSeen = Date.now();
  room.members.set(cleanName, member);

  res.json({ ok: true });
});

// Set AFK
app.post('/api/rooms/:room/afk', (req, res) => {
  const { name, afk, reason } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const room = getRoom(req.params.room);
  const cleanName = name.trim();
  const member = room.members.get(cleanName) || { name: cleanName, lastSeen: Date.now() };

  member.afk = afk !== false; // defaults to true if not specified
  member.afkReason = reason || '';
  member.lastSeen = Date.now();
  room.members.set(cleanName, member);

  broadcastToRoom(req.params.room, {
    type: 'AFK_UPDATE',
    room: req.params.room,
    member,
  });

  res.json({ ok: true, member });
});

// Get room members & AFK status
app.get('/api/rooms/:room/members', (req, res) => {
  const room = getRoom(req.params.room);
  const now = Date.now();
  const list = [];

  for (const m of room.members.values()) {
    // If not seen in 60s, automatically consider AFK
    const isAfk = m.afk || (now - m.lastSeen > AFK_TIMEOUT_MS);
    list.push({
      name: m.name,
      afk: isAfk,
      afkReason: m.afkReason || (now - m.lastSeen > AFK_TIMEOUT_MS ? 'idle timeout' : ''),
      lastSeenSecondsAgo: Math.floor((now - m.lastSeen) / 1000),
    });
  }

  res.json({ room: req.params.room, members: list });
});

// Send message
app.post('/api/rooms/:room/messages', (req, res) => {
  const { name, text } = req.body;
  if (!name || !text) {
    return res.status(400).json({ error: 'name and text are required' });
  }

  const room = getRoom(req.params.room);
  const cleanName = name.trim();

  // Update member lastSeen & remove AFK when sending message
  const member = room.members.get(cleanName) || { name: cleanName, afk: false, afkReason: '', lastSeen: Date.now() };
  member.lastSeen = Date.now();
  member.afk = false;
  member.afkReason = '';
  room.members.set(cleanName, member);

  const msg = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    room: req.params.room,
    name: cleanName,
    text: String(text).trim(),
    time: Date.now(),
  };

  room.messages.push(msg);
  if (room.messages.length > 500) {
    room.messages.shift();
  }

  broadcastToRoom(req.params.room, {
    type: 'MESSAGE',
    room: req.params.room,
    message: msg,
  });

  res.json(msg);
});

// Read messages
app.get('/api/rooms/:room/messages', (req, res) => {
  const room = getRoom(req.params.room);
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const since = parseInt(req.query.since || '0', 10);

  let msgs = room.messages;
  if (since > 0) {
    msgs = msgs.filter((m) => m.time > since);
  }

  res.json(msgs.slice(-limit));
});

// WebSocket Server for live message streaming
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const roomCode = (url.searchParams.get('room') || 'default').trim().toLowerCase();
  const name = url.searchParams.get('name');

  if (!wsClients.has(roomCode)) {
    wsClients.set(roomCode, new Set());
  }
  const clients = wsClients.get(roomCode);
  clients.add(ws);

  if (name) {
    const room = getRoom(roomCode);
    const member = room.members.get(name) || { name, afk: false, afkReason: '', lastSeen: Date.now() };
    member.lastSeen = Date.now();
    room.members.set(name, member);
  }

  ws.on('close', () => {
    clients.delete(ws);
    if (clients.size === 0) {
      wsClients.delete(roomCode);
    }
  });

  ws.on('error', () => {
    clients.delete(ws);
  });
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
    console.log(`\n📡 Simple Message Board Relay is running!\n`);
    console.log(`Local:  ${localUrl}`);
    if (publicUrl) {
      console.log(`Public: ${publicUrl}  <-- Share this with colleagues on other networks!`);
    }
    console.log(`\nCommands:`);
    console.log(`  node cli.js send --server ${publicUrl || localUrl} --room hack1 --name Kacper "hello"`);
    console.log(`  node cli.js listen --server ${publicUrl || localUrl} --room hack1\n`);
  });
}

module.exports = { startServer, app, server };
