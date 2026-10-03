#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const { WebSocket } = require('ws');
const { startServer } = require('./server');

// Local config path (~/.roomrc or ./.roomrc)
const RC_PATH = path.resolve(process.cwd(), '.roomrc');

function loadConfig() {
  const config = {
    server: process.env.ROOM_SERVER || 'http://localhost:8765',
    room: process.env.ROOM_CODE || 'general',
    name: process.env.ROOM_NAME || 'agent-' + Math.floor(Math.random() * 1000),
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

function saveConfig(updates) {
  const existing = loadConfig();
  const merged = { ...existing, ...updates };
  fs.writeFileSync(RC_PATH, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function resolveOptions(cmdOpts) {
  const cfg = loadConfig();
  return {
    server: (cmdOpts.server || cfg.server).replace(/\/$/, ''),
    room: (cmdOpts.room || cfg.room).trim().toLowerCase(),
    name: (cmdOpts.name || cfg.name).trim(),
  };
}

async function request(serverUrl, endpoint, method = 'GET', body = null) {
  const url = `${serverUrl}${endpoint}`;
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Server error (${res.status}): ${errText}`);
  }
  return res.json();
}

program
  .name('room')
  .description('Simple Terminal Message Board for AI Agents and Hackathon Teams')
  .version('1.0.0');

// 1. CONFIG
program
  .command('config')
  .description('Save default server URL, room code, and your name')
  .option('-s, --server <url>', 'Server URL')
  .option('-r, --room <code>', 'Room code')
  .option('-n, --name <name>', 'Your name or agent name')
  .action((opts) => {
    const updates = {};
    if (opts.server) updates.server = opts.server;
    if (opts.room) updates.room = opts.room;
    if (opts.name) updates.name = opts.name;

    const saved = saveConfig(updates);
    console.log(`Saved configuration to .roomrc:`);
    console.log(`  Server: ${saved.server}`);
    console.log(`  Room:   ${saved.room}`);
    console.log(`  Name:   ${saved.name}`);
  });

// 2. SEND
program
  .command('send [message...]')
  .description('Send a text message to the room')
  .option('-s, --server <url>', 'Server URL')
  .option('-r, --room <code>', 'Room code')
  .option('-n, --name <name>', 'Your name')
  .action(async (msgParts, opts) => {
    try {
      const { server, room, name } = resolveOptions(opts);
      const text = msgParts.join(' ').trim();
      if (!text) {
        console.error('Error: Message text cannot be empty.');
        process.exit(1);
      }

      const res = await request(server, `/api/rooms/${encodeURIComponent(room)}/messages`, 'POST', {
        name,
        text,
      });

      console.log(`[${room}] ${name}: ${res.text}`);
    } catch (err) {
      console.error(`Failed to send message: ${err.message}`);
      process.exit(1);
    }
  });

// 3. READ
program
  .command('read')
  .description('Read recent messages from the room')
  .option('-s, --server <url>', 'Server URL')
  .option('-r, --room <code>', 'Room code')
  .option('-l, --limit <number>', 'Number of messages to read', '20')
  .action(async (opts) => {
    try {
      const { server, room } = resolveOptions(opts);
      const limit = parseInt(opts.limit, 10) || 20;
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
      console.error(`Failed to read messages: ${err.message}`);
      process.exit(1);
    }
  });

// 4. LISTEN / STREAM
program
  .command('listen')
  .description('Live stream incoming messages in real-time to stdout')
  .option('-s, --server <url>', 'Server URL')
  .option('-r, --room <code>', 'Room code')
  .option('-n, --name <name>', 'Your name')
  .action(async (opts) => {
    const { server, room, name } = resolveOptions(opts);
    const wsProto = server.startsWith('https') ? 'wss' : 'ws';
    const host = server.replace(/^http(s)?:\/\//, '');
    const wsUrl = `${wsProto}://${host}/?room=${encodeURIComponent(room)}&name=${encodeURIComponent(name)}`;

    console.log(`Connecting to room '${room}' at ${server}... (Ctrl+C to stop)`);

    // Register presence
    try {
      await request(server, `/api/rooms/${encodeURIComponent(room)}/join`, 'POST', { name });
    } catch (e) {}

    const ws = new WebSocket(wsUrl);

    // Heartbeat every 25s
    const hb = setInterval(() => {
      request(server, `/api/rooms/${encodeURIComponent(room)}/heartbeat`, 'POST', { name }).catch(() => {});
    }, 25000);

    ws.on('open', () => {
      console.log(`Connected. Listening for messages in '${room}'...\n`);
    });

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.type === 'MESSAGE' && data.message) {
          const m = data.message;
          const time = new Date(m.time).toLocaleTimeString();
          console.log(`[${time}] ${m.name}: ${m.text}`);
        } else if (data.type === 'AFK_UPDATE' && data.member) {
          const status = data.member.afk ? `AFK (${data.member.afkReason || 'away'})` : 'BACK';
          console.log(`* ${data.member.name} is now ${status}`);
        }
      } catch (e) {}
    });

    ws.on('close', () => {
      clearInterval(hb);
      console.log('\nDisconnected from room.');
    });

    ws.on('error', (err) => {
      clearInterval(hb);
      console.error(`Connection error: ${err.message}`);
    });
  });

// 5. AFK
program
  .command('afk [status]')
  .description('Set AFK status (on / off) with optional reason')
  .option('-s, --server <url>', 'Server URL')
  .option('-r, --room <code>', 'Room code')
  .option('-n, --name <name>', 'Your name')
  .option('-m, --reason <reason>', 'AFK reason (e.g. "lunch", "coding auth")')
  .action(async (status, opts) => {
    try {
      const { server, room, name } = resolveOptions(opts);
      const isAfk = status !== 'off' && status !== 'back';
      const reason = opts.reason || (isAfk ? 'away' : '');

      const res = await request(server, `/api/rooms/${encodeURIComponent(room)}/afk`, 'POST', {
        name,
        afk: isAfk,
        reason,
      });

      if (isAfk) {
        console.log(`✓ Set ${name} as AFK in room '${room}' (Reason: ${reason})`);
      } else {
        console.log(`✓ Set ${name} as ACTIVE (back) in room '${room}'`);
      }
    } catch (err) {
      console.error(`Failed to update AFK status: ${err.message}`);
      process.exit(1);
    }
  });

// 6. WHO
program
  .command('who')
  .description('List members in the room and their AFK status')
  .option('-s, --server <url>', 'Server URL')
  .option('-r, --room <code>', 'Room code')
  .action(async (opts) => {
    try {
      const { server, room } = resolveOptions(opts);
      const data = await request(server, `/api/rooms/${encodeURIComponent(room)}/members`);

      console.log(`\nMembers in room '${room}':`);
      if (!data.members || data.members.length === 0) {
        console.log('  (No active members recorded)');
        return;
      }

      for (const m of data.members) {
        const status = m.afk ? `[AFK - ${m.afkReason || 'idle'}]` : `[ACTIVE]`;
        const lastSeen = m.lastSeenSecondsAgo < 60 ? `${m.lastSeenSecondsAgo}s ago` : `${Math.floor(m.lastSeenSecondsAgo / 60)}m ago`;
        console.log(`  • ${m.name.padEnd(20)} ${status.padEnd(22)} (seen ${lastSeen})`);
      }
      console.log();
    } catch (err) {
      console.error(`Failed to list members: ${err.message}`);
      process.exit(1);
    }
  });

// 7. SERVER
program
  .command('server')
  .description('Run the room relay server')
  .option('-p, --port <port>', 'Port number', '8765')
  .option('--public', 'Create public WAN Cloudflare tunnel', false)
  .action(async (opts) => {
    process.env.PORT = opts.port;
    const { localUrl, publicUrl } = await startServer(opts.public);
    console.log(`\n📡 Room server running!`);
    console.log(`Local:  ${localUrl}`);
    if (publicUrl) {
      console.log(`Public: ${publicUrl}  <-- Share with teammates across networks`);
    }
    console.log(`\nTo set this as your default server:`);
    console.log(`  node cli.js config --server ${publicUrl || localUrl} --room myroom --name myname\n`);
  });

program.parse(process.argv);
