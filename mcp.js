const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const fs = require('fs');
const path = require('path');

// Load default config
let serverUrl = process.env.ROOM_SERVER || 'http://localhost:8765';
let defaultRoom = process.env.ROOM_CODE || 'general';
let defaultName = process.env.ROOM_NAME || 'AI-Agent';

const rcPath = path.resolve(process.cwd(), '.roomrc');
if (fs.existsSync(rcPath)) {
  try {
    const rc = JSON.parse(fs.readFileSync(rcPath, 'utf8'));
    if (rc.server) serverUrl = rc.server;
    if (rc.room) defaultRoom = rc.room;
    if (rc.name) defaultName = rc.name;
  } catch (e) {}
}

async function request(endpoint, method = 'GET', body = null) {
  const url = `${serverUrl.replace(/\/$/, '')}${endpoint}`;
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

async function main() {
  const server = new Server(
    { name: `room-agent-${defaultName}`, version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'send_message',
          description: 'Post a text message to the team message board.',
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'The text message to send.' },
              room: { type: 'string', description: 'Room code (optional, defaults to configured room).' },
              name: { type: 'string', description: 'Your sender name (optional).' },
            },
            required: ['text'],
          },
        },
        {
          name: 'read_messages',
          description: 'Read recent messages from the room.',
          inputSchema: {
            type: 'object',
            properties: {
              limit: { type: 'number', description: 'Number of recent messages to read (default: 20).' },
              room: { type: 'string', description: 'Room code (optional).' },
            },
          },
        },
        {
          name: 'set_afk',
          description: 'Set your status to AFK (away from keyboard) or active.',
          inputSchema: {
            type: 'object',
            properties: {
              afk: { type: 'boolean', description: 'True if AFK/busy, false if active/back.' },
              reason: { type: 'string', description: 'Reason for being AFK (optional).' },
              room: { type: 'string', description: 'Room code (optional).' },
            },
            required: ['afk'],
          },
        },
        {
          name: 'who_is_here',
          description: 'See who is currently active or AFK in the room.',
          inputSchema: {
            type: 'object',
            properties: {
              room: { type: 'string', description: 'Room code (optional).' },
            },
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const room = (args.room || defaultRoom).trim().toLowerCase();
    const sender = (args.name || defaultName).trim();

    try {
      if (name === 'send_message') {
        const res = await request(`/api/rooms/${encodeURIComponent(room)}/messages`, 'POST', {
          name: sender,
          text: args.text,
        });
        return { content: [{ type: 'text', text: `Sent to [${room}] ${sender}: ${res.text}` }] };
      }

      if (name === 'read_messages') {
        const limit = args.limit || 20;
        const msgs = await request(`/api/rooms/${encodeURIComponent(room)}/messages?limit=${limit}`);
        const formatted = msgs.map((m) => `[${new Date(m.time).toLocaleTimeString()}] ${m.name}: ${m.text}`).join('\n');
        return { content: [{ type: 'text', text: formatted || 'No messages in room.' }] };
      }

      if (name === 'set_afk') {
        const res = await request(`/api/rooms/${encodeURIComponent(room)}/afk`, 'POST', {
          name: sender,
          afk: args.afk,
          reason: args.reason || '',
        });
        const status = res.member.afk ? `AFK (${res.member.afkReason})` : 'ACTIVE';
        return { content: [{ type: 'text', text: `${sender} is now ${status} in room '${room}'.` }] };
      }

      if (name === 'who_is_here') {
        const data = await request(`/api/rooms/${encodeURIComponent(room)}/members`);
        const formatted = (data.members || [])
          .map((m) => `- ${m.name}: ${m.afk ? `[AFK - ${m.afkReason || 'idle'}]` : '[ACTIVE]'} (seen ${m.lastSeenSecondsAgo}s ago)`)
          .join('\n');
        return { content: [{ type: 'text', text: `Room '${room}' members:\n${formatted || '(No members)'}` }] };
      }

      throw new Error(`Unknown tool: ${name}`);
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: `Error: ${err.message}` }] };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
