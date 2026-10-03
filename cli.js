#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const { WebSocket } = require('ws');
const { startServer } = require('./server');

const RC_PATH = path.resolve(process.cwd(), '.roomrc');

function loadConfig() {
  const config = {
    server: process.env.ROOM_SERVER || 'http://localhost:8765',
    room: process.env.ROOM_CODE || 'general',
    name: process.env.ROOM_NAME || 'agent',
  };

  if (fs.existsSync(RC_PATH)) {
    try {
      const saved = JSON.parse(fs.readFileSync(RC_PATH, 'utf8'));
      if (saved.server) config.server = saved.server;
      if (saved.room) config.room = saved.room;
      if (saved.name) config.name = saved.name;
    } catch (e) {}
  }

  return config;
}

function resolveOptions(opts = {}) {
  const cfg = loadConfig();
  return {
    server: (opts.server || cfg.server).replace(/\/$/, ''),
    room: (opts.room || cfg.room).trim().toLowerCase(),
    name: (opts.name || cfg.name).trim(),
  };
}

async function request(serverUrl, endpoint, method = 'GET', body = null) {
  const url = `${serverUrl}${endpoint}`;
  const options = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

program
  .name('room')
  .description('Simple Terminal Message Board for AI Agents & Hackathons')
  .version('1.0.0');

// CONFIG
program
  .command('config')
  .description('Set default server, room code, and name')
  .option('-s, --server <url>', 'Server URL')
  .option('-r, --room <code>', 'Room code')
  .option('-n, --name <name>', 'Your name or agent name')
  .action((opts) => {
    const existing = loadConfig();
    const merged = {
      server: opts.server || existing.server,
      room: opts.room || existing.room,
      name: opts.name || existing.name,
    };
    fs.writeFileSync(RC_PATH, JSON.stringify(merged, null, 2), 'utf8');
    console.log(`Saved .roomrc:`);
    console.log(`  Server: ${merged.server}`);
    console.log(`  Room:   ${merged.room}`);
    console.log(`  Name:   ${merged.name}`);
  });

// SEND
program
  .command('send [message...]')
  .description('Send a text message')
  .option('-s, --server <url>', 'Server URL')
  .option('-r, --room <code>', 'Room code')
  .option('-n, --name <name>', 'Sender name')
  .action(async (msgParts, opts) => {
    try {
      const { server, room, name } = resolveOptions(opts);
      const text = msgParts.join(' ').trim();
      if (!text) {
        console.error('Error: Message text required');
        process.exit(1);
      }

      await request(server, `/api/rooms/${encodeURIComponent(room)}/messages`, 'POST', { name, text });
      console.log(`[${room}] ${name}: ${text}`);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// READ
program
  .command('read [limit]')
  .description('Read recent messages')
  .option('-s, --server <url>', 'Server URL')
  .option('-r, --room <code>', 'Room code')
  .action(async (limitArg, opts) => {
    try {
      const { server, room } = resolveOptions(opts);
      const limit = parseInt(limitArg || '20', 10);
      const msgs = await request(server, `/api/rooms/${encodeURIComponent(room)}/messages?limit=${limit}`);

      if (msgs.length === 0) {
        console.log(`(No messages in room '${room}')`);
        return;
      }

      for (const m of msgs) {
        const time = new Date(m.time).toLocaleTimeString();
        console.log(`[${time}] ${m.name}: ${m.text}`);
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// LISTEN
program
  .command('listen')
  .description('Stream incoming messages in real-time')
  .option('-s, --server <url>', 'Server URL')
  .option('-r, --room <code>', 'Room code')
  .action(async (opts) => {
    const { server, room } = resolveOptions(opts);
    const wsProto = server.startsWith('https') ? 'wss' : 'ws';
    const host = server.replace(/^http(s)?:\/\//, '');
    const wsUrl = `${wsProto}://${host}/?room=${encodeURIComponent(room)}`;

    console.log(`Listening to '${room}' on ${server}... (Ctrl+C to exit)\n`);
    const ws = new WebSocket(wsUrl);

    ws.on('message', (raw) => {
      try {
        const m = JSON.parse(raw.toString());
        const time = new Date(m.time).toLocaleTimeString();
        console.log(`[${time}] ${m.name}: ${m.text}`);
      } catch (e) {}
    });

    ws.on('close', () => console.log('\nDisconnected.'));
    ws.on('error', (err) => console.error(`Error: ${err.message}`));
  });

// SERVER
program
  .command('server')
  .description('Start the message board server')
  .option('-p, --port <port>', 'Port number', '8765')
  .option('--public', 'Create public Cloudflare tunnel', false)
  .action(async (opts) => {
    process.env.PORT = opts.port;
    const { localUrl, publicUrl } = await startServer(opts.public);
    console.log(`\n📡 Server running!`);
    console.log(`Local:  ${localUrl}`);
    if (publicUrl) console.log(`Public: ${publicUrl}`);
    console.log();
  });

program.parse(process.argv);
