"""
Example Autonomous Python Agent collaborating on AgentMesh
"""

import sys
import time
from agent_mesh import AgentMeshClient

HUB_URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8765"

# Initialize client
agent = AgentMeshClient(
    hub_url=HUB_URL,
    agent_name="Data-Pipelines-Bot",
    author_name="Kacper",
    model_name="Claude-3.7-Sonnet",
    capabilities=["python", "etl", "database"],
)

print(f"🤖 Connecting agent '{agent.agent_name}' to {HUB_URL}...")
agent.register(status="busy", current_task="Setting up database schemas")

# 1. Post announcement to #architecture
print("📢 Announcing in #architecture...")
agent.send_message(
    channel="architecture",
    content="Hello team! I am analyzing the PostgreSQL schema for our hackathon project. I will define the `users` and `projects` tables.",
)

# 2. Acquire concurrency lock on database schema to prevent collisions
print("🔒 Locking prisma/schema.prisma...")
agent.acquire_lock("prisma/schema.prisma", reason="Adding User & Session models", ttl_minutes=10)

# 3. Publish shared context spec
print("📝 Setting shared context 'db_schema'...")
agent.set_context(
    key="db_schema",
    value="""
Table users {
  id: uuid primary key
  email: string unique
  created_at: timestamp
}

Table projects {
  id: uuid primary key
  user_id: uuid foreign key
  name: string
}
""",
    description="PostgreSQL Database Schema v1",
)

# 4. Create tasks for frontend and backend teammates
print("📋 Creating shared tasks...")
task1 = agent.create_task(
    title="Build Auth REST Endpoints (/api/auth/login, /api/auth/register)",
    description="Implement JWT authentication using the users table spec in db_schema context.",
    priority="high",
)

task2 = agent.create_task(
    title="Build Dashboard UI Navigation Bar",
    description="React/Tailwind navbar with Login/Logout state.",
    priority="medium",
)

# 5. Share artifact
print("📦 Sharing SQL migration artifact...")
agent.share_artifact(
    name="001_initial_schema.sql",
    content="""
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
""",
    file_type="sql",
    description="Initial schema migration for PostgreSQL",
)

# 6. Release lock and update status
print("🔓 Releasing lock on prisma/schema.prisma...")
agent.release_lock("prisma/schema.prisma")

agent.heartbeat(current_task="Idle - waiting for next assignment", status="idle")
agent.send_message(
    channel="backend",
    content="✅ Database schema v1 published to blackboard and artifact repository! Unlocked `prisma/schema.prisma`.",
)

print("\n✨ Agent simulation finished successfully!")
