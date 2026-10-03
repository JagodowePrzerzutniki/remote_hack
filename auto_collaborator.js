const { WebSocket } = require('ws');

const SERVER = process.env.ROOM_SERVER || 'https://subjective-recipient-approximately-calling.trycloudflare.com';
const ROOM = process.env.ROOM_CODE || 'hack-live';
const AGENT_NAME = process.env.ROOM_NAME || 'Agent-Antigravity';

const KNOWN_SELF_AGENTS = new Set(['agent-antigravity', 'agent-alpha', 'agent-beta']);

async function sendMessage(room, text) {
  const url = `${SERVER.replace(/\/$/, '')}/api/rooms/${encodeURIComponent(room)}/messages`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: AGENT_NAME, text }),
    });
    return await res.json();
  } catch (err) {
    console.error(`[Error sending message]: ${err.message}`);
  }
}

async function readMessages(room, limit = 20) {
  const url = `${SERVER.replace(/\/$/, '')}/api/rooms/${encodeURIComponent(room)}/messages?limit=${limit}`;
  try {
    const res = await fetch(url);
    return await res.json();
  } catch (err) {
    return [];
  }
}

async function main() {
  console.log(`\n🤖 Auto-Collaborator started for agent '${AGENT_NAME}'`);
  console.log(`📡 Server: ${SERVER}`);
  console.log(`🏠 Room:   ${ROOM}`);
  console.log(`⏳ Listening for external agents and sending pings until communication is achieved...\n`);

  let communicationAchieved = false;
  const processedMessageIds = new Set();

  // Load existing messages to avoid replying to old ones
  const initial = await readMessages(ROOM, 50);
  for (const m of initial) {
    processedMessageIds.add(m.id || `${m.time}-${m.name}`);
  }

  // Initial greeting ping
  await sendMessage(ROOM, `👋 Hello! ${AGENT_NAME} is active in room '${ROOM}' and ready to communicate with other agents. Post a message to connect!`);

  const wsProto = SERVER.startsWith('https') ? 'wss' : 'ws';
  const host = SERVER.replace(/^http(s)?:\/\//, '');
  const wsUrl = `${wsProto}://${host}/?room=${encodeURIComponent(ROOM)}`;

  let ws;
  function connectWS() {
    ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      console.log(`[WS] Connected to live room stream '${ROOM}'`);
    });

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        await handleIncomingMessage(msg);
      } catch (e) {}
    });

    ws.on('close', () => {
      console.log('[WS] Connection closed, reconnecting in 2s...');
      setTimeout(connectWS, 2000);
    });

    ws.on('error', (err) => {
      console.error(`[WS Error]: ${err.message}`);
    });
  }

  async function handleIncomingMessage(msg) {
    if (!msg || !msg.name || !msg.text) return;
    const msgKey = msg.id || `${msg.time}-${msg.name}-${msg.text}`;
    if (processedMessageIds.has(msgKey)) return;
    processedMessageIds.add(msgKey);

    const senderName = msg.name.trim();
    const senderLower = senderName.toLowerCase();

    const time = new Date(msg.time || Date.now()).toLocaleTimeString();
    console.log(`[${time}] Received from ${senderName}: "${msg.text}"`);

    // Check if it's from another agent
    if (!KNOWN_SELF_AGENTS.has(senderLower)) {
      console.log(`\n🎉 NEW AGENT DETECTED: "${senderName}"!`);
      console.log(`📝 Message: "${msg.text}"`);

      // Reply back to them immediately!
      const reply = `Hi @${senderName}! I am ${AGENT_NAME}. I received your message: "${msg.text}". Let's coordinate! What feature are you working on?`;
      await sendMessage(ROOM, reply);
      console.log(`💬 Sent reply to ${senderName}: "${reply}"`);

      console.log(`\n======================================================`);
      console.log(`🎯 SUCCESS: Two-way communication achieved with external agent '${senderName}'!`);
      console.log(`======================================================\n`);
      communicationAchieved = true;
    }
  }

  connectWS();

  // Periodic poll + ping loop every 15 seconds
  let pingCount = 0;
  setInterval(async () => {
    // 1. Fallback REST poll
    const msgs = await readMessages(ROOM, 20);
    for (const m of msgs) {
      await handleIncomingMessage(m);
    }

    // 2. Periodic broadcast ping if not yet connected
    if (!communicationAchieved) {
      pingCount++;
      if (pingCount % 2 === 0) { // every 30s
        await sendMessage(ROOM, `⚡ [Ping #${pingCount/2}] ${AGENT_NAME} waiting for teammate agents in '${ROOM}'...`);
      }
    }
  }, 15000);
}

main().catch(console.error);
