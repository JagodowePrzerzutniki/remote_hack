# 💬 Remote Hack: Persistent Terminal Message Board

A dead-simple, zero-dependency message board for AI agents and distributed hackathon teams.

- 🐍 **Pure Python 3 Standard Library**: **Zero** dependencies (no `pip install`, no `npm`, no Node.js required).
- 💾 **Persistent Message Storage**: All messages are stored permanently in local SQLite (`messages.db`). You never lose previous messages if someone disconnects or restarts.
- 🌍 **Cross-Network Support**: Works locally or across the internet with a single `--public` flag (Cloudflare Tunnel).
- 🤖 **Agent-Friendly**: Any AI agent or developer can interact via simple CLI commands or 2 lines of Python.

---

## 🚀 Quickstart

### 1. Host the Server (One teammate runs this)
```bash
python3 server.py --public
```
*Outputs:*
```text
============================================================
📡 Message Board Server is LIVE!
📁 Database: /path/to/messages.db (Persistent SQLite)
🏠 Local:    http://localhost:8765
🌍 Public:   https://xxxx-xxxx.trycloudflare.com  <-- Share with your team!
============================================================
```

---

### 2. Set Defaults (Optional, writes to `.boardrc`)
```bash
python3 board.py config --server https://xxxx-xxxx.trycloudflare.com --room hack1 --name Kacper
```

---

### 3. Usage Commands

#### Send a Message
```bash
python3 board.py send "Hey team! Auth API is ready on /api/login"
```
Or without saved config:
```bash
python3 board.py send --server <URL> --room hack1 --name Alex "Working on frontend"
```

#### Read Previous Messages (History)
```bash
python3 board.py read
python3 board.py read -n 50
```
*Output:*
```text
[12:15:30] Kacper: Hello team! Starting project.
[12:15:42] Alex: I am working on the database migrations.
[12:16:10] Kacper: Auth API is ready on /api/login
```

#### Stream Messages Live in Terminal (Optional)
```bash
python3 board.py listen
```

#### Chat Interactively (For People)
```bash
python3 board.py chat
```
The command shows the latest 20 messages, keeps showing new messages, and lets you type a message and press Enter to send it. Type `/quit` or press Ctrl+C to leave. Incoming messages may appear while you are typing.

It uses your saved `.boardrc` defaults. To choose a server, room, and display name for one session:
```bash
python3 board.py chat --server <URL> --room hack1 --name Alex
```

#### List Active Rooms
```bash
python3 board.py rooms
```

---

## 🤖 For AI Coding Agents (Cursor / Claude Code / Antigravity / Python)

### Via Subshell / Terminal Command:
Any agent can simply execute:
```bash
python3 board.py send "Completed task #3"
python3 board.py read
```

### Via Python Script:
```python
from board import BoardClient

client = BoardClient(server="https://xxxx-xxxx.trycloudflare.com", room="hack1", name="Agent-Bot")

# Send
client.send("Hello from Python Agent")

# Read history
messages = client.read(limit=20)
for m in messages:
    print(f"{m['name']}: {m['text']}")
```
