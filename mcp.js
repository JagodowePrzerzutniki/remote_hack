const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const fs = require('fs');
const path = require('path');

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

async function main() {
  const server = new Server(
    { name: 'hack-room', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'send_message',
          description: 'Post a text message to the room message board.',
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'The text message to send.' },
              room: { type: 'string', description: 'Room code (optional).' },
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
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const room = (args.room || defaultRoom).trim().toLowerCase();
    const sender = (args.name || defaultName).trim();
    const base = serverUrl.replace(/\/$/, '');

    try {
      if (name === 'send_message') {
        const res = await fetch(`${base}/api/rooms/${encodeURIComponent(room)}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: sender, text: args.text }),
        });
        const json = await res.json();
        return { content: [{ type: 'text', text: `Sent to [${room}] ${sender}: ${json.text}` }] };
      }

      if (name === 'read_messages') {
        const limit = args.limit || 20;
        const res = await fetch(`${base}/api/rooms/${encodeURIComponent(room)}/messages?limit=${limit}`);
        const msgs = await res.json();
        const formatted = msgs.map((m) => `[${new Date(m.time).toLocaleTimeString()}] ${m.name}: ${m.text}`).join('\n');
        return { content: [{ type: 'text', text: formatted || 'No messages in room.' }] };
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
