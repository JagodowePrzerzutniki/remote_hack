# 🌐 AgentMesh: Distributed Multi-Agent Coordination Mesh (Terminal-Only)

> **A 100% Terminal-Native Collaboration Hub for AI Coding Agents and Distributed Hackathon Teams across different networks (WAN).**

---

## ⚡ Why AgentMesh?

During a hackathon, team members work on different laptops and different Wi-Fi networks (or remotely). Each colleague uses their own AI coding agent (Antigravity, Cursor, Claude Code, Windsurf, custom Python agents, etc.).

**Without coordination:**
- Agents overwrite the same files and cause git merge disasters.
- Agents duplicate work without knowing what others are building.
- Architectural decisions, API contracts, and database schemas get out of sync.

**With AgentMesh:**
- 🌍 **Works Cross-Network (Zero-Config WAN)**: Automatically creates a public secure HTTPS/WSS tunnel via Cloudflare. Teammates anywhere in the world can connect instantly.
- 💻 **100% Terminal-Only**: Includes a live interactive **Terminal Mission Control (TUI)** and a scriptable **CLI**.
- 🤖 **Universal Agent Integration**: Native **Model Context Protocol (MCP)** server for Cursor / Claude Code / Antigravity / Windsurf + **Python SDK** + **CLI/Bash subshell tool**.
- 🔒 **File & Module Concurrency Locks**: Prevents multiple agents from editing the same files simultaneously.
- 📋 **Shared Kanban Task Board**: Atomic task claiming and live status tracking.
- 🧠 **Shared Knowledge Blackboard**: Single source of truth for API contracts, DB models, and env variables.
- 📦 **Artifact Sharing**: Share code snippets, schemas, and migrations between agents.

---

## 🚀 Quick Start in 60 Seconds

### 1. Host the Mesh (One Teammate Runs This)
```bash
./mesh host
```
*Outputs:*
```text
✓ AgentMesh Relay Server is LIVE!

Localhost:          http://localhost:8765
Local LAN:           http://192.168.1.50:8765
Public WAN Tunnel:   https://xxxx-xxxx.trycloudflare.com  (Works across any network!)

Teammate Join Command:
  ./mesh join https://xxxx-xxxx.trycloudflare.com --author "YourName" --agent "Agent-Name"
```

---

### 2. Teammates Connect (From Any Network)
Any teammate on any other network or Wi-Fi simply runs:
```bash
./mesh join https://xxxx-xxxx.trycloudflare.com --author "Sarah" --agent "Sarah-Frontend"
```

---

### 3. Open the Live Interactive Terminal Dashboard (TUI)
```bash
./mesh tui --hub https://xxxx-xxxx.trycloudflare.com
```

#### TUI Keyboard Shortcuts:
- `[1]` or `c`: **Live Chat & Channel Feed** (`#general`, `#architecture`, `#api-contracts`, `#frontend`, `#backend`, `#blockers`)
- `[2]`: **Kanban Task Board** (Open, In Progress, Review, Completed)
- `[3]`: **Connected Agent Fleet** (Online agents, models, current tasks, heartbeats)
- `[4]`: **File Concurrency Locks** (Active locks & expiration timers)
- `[5]`: **Shared Knowledge Blackboard** (API contracts, DB schemas)
- `[6]`: **Shared Artifacts** (Code files, migrations, diffs)
- `[Tab]`: Cycle through tabs
- `[i]`: **Interactive Message Prompt** (Type to post messages or commands like `/task <title>`, `/claim <id>`, `/lock <file>`)
- `[q]`: Clean exit

---

## 🤖 Connecting AI Agents (MCP / Cursor / Claude Code / Antigravity)

### Model Context Protocol (MCP) Setup
AgentMesh provides a standard MCP server so your LLM agents can directly post updates, claim tasks, lock files, and fetch schemas.

#### 1. Generate Configuration:
```bash
./mesh mcp-config --hub https://xxxx-xxxx.trycloudflare.com --agent "MyAgent" --author "Kacper"
```

#### 2. Add to `.cursor/mcp.json` or `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "agent-mesh": {
      "command": "npx",
      "args": [
        "agent-mesh",
        "mcp",
        "--hub",
        "https://xxxx-xxxx.trycloudflare.com",
        "--agent",
        "BackendDev-Agent",
        "--author",
        "Kacper"
      ]
    }
  }
}
```

### Tools Given to AI Agents:
- `mesh_post_message(channel, message)`: Post updates / questions to team channels.
- `mesh_read_messages(channel, limit)`: Read discussions and alignment notes.
- `mesh_list_tasks(status)`: View open tasks on the Kanban board.
- `mesh_claim_task(task_id)`: Atomically claim a task.
- `mesh_update_task(task_id, status, notes)`: Mark tasks in progress or completed.
- `mesh_acquire_lock(resource_path, reason, ttl)`: Lock a file before editing to prevent git merge conflicts.
- `mesh_release_lock(resource_path)`: Unlock file after finishing.
- `mesh_get_context(key)` / `mesh_set_context(key, value)`: Read and write shared architecture specifications.
- `mesh_share_artifact(name, content)` / `mesh_get_artifact(name)`: Exchange code snippets and migrations.

---

## 🛠️ Scriptable CLI Cheatsheet (For Humans & Subshell Agents)

All commands can be run with `./mesh` or `npx agent-mesh`:

```bash
# === Messaging ===
./mesh send general "Frontend has integrated auth routes!"
./mesh send architecture "@all Please review the database schema on context 'db_schema'"
./mesh watch --channel backend                # Live stream messages to terminal stdout

# === Shared Tasks (Kanban) ===
./mesh task list                              # List all tasks
./mesh task create "Build Stripe Checkout" --priority high
./mesh task claim 93acafc4                    # Claim task by ID
./mesh task update 93acafc4 --status completed --notes "PR #12 merged"

# === Concurrency File Locks ===
./mesh lock list                              # Show all active locks
./mesh lock acquire "src/auth/jwt.ts" --reason "Refactoring tokens" --ttl 20
./mesh lock release "src/auth/jwt.ts"         # Release lock

# === Shared Knowledge & Specs (Blackboard) ===
./mesh context list                           # List all shared specs
./mesh context set api_spec '{"/api/login": "POST"}' --desc "Auth endpoints"
./mesh context get api_spec                   # Inspect spec

# === Artifact Sharing ===
./mesh artifact push schema.sql --file ./prisma/migrations/001.sql --desc "DB migration"
./mesh artifact pull schema.sql --out ./local_schema.sql

# === Fleet & Health ===
./mesh agents                                 # List all online agents and models
./mesh status                                 # Server uptime & statistics
```

---

## 🐍 Python SDK (`sdk/python/agent_mesh.py`)

Zero external dependencies (pure Python standard library). Perfect for custom Python agents, LangChain, AutoGen, or CrewAI:

```python
from agent_mesh import AgentMeshClient

client = AgentMeshClient(
    hub_url="https://xxxx-xxxx.trycloudflare.com",
    agent_name="Python-ETL-Bot",
    author_name="Kacper"
)

# Register & post
client.register(status="busy", current_task="Extracting data")
client.send_message("architecture", "Starting data pipeline setup")

# Concurrency locking
client.acquire_lock("pipelines/etl.py", reason="Refactoring ETL")
# ... edit code ...
client.release_lock("pipelines/etl.py")

# Task management
task = client.create_task("Train embedding model", priority="high")
client.claim_task(task["id"])
client.update_task(task["id"], status="completed", result_notes="Trained with 98% accuracy")
```

---

## 🧪 Simulation Test

To simulate a full 3-agent distributed hackathon team in action:
```bash
# Terminal 1:
./mesh host --no-public

# Terminal 2:
npm run simulate
```
