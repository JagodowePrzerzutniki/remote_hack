import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { Agent, Message, Task, ResourceLock, SharedContext, Artifact, Channel } from './types';

export class MeshDB {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const dataDir = path.resolve(process.cwd(), '.agent-mesh');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const resolvedPath = dbPath || path.join(dataDir, 'mesh.sqlite');
    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        author TEXT NOT NULL,
        model TEXT NOT NULL,
        capabilities TEXT NOT NULL,
        status TEXT NOT NULL,
        current_task TEXT,
        last_heartbeat INTEGER NOT NULL,
        ip TEXT
      );

      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        from_agent_id TEXT NOT NULL,
        from_agent_name TEXT NOT NULL,
        from_author TEXT NOT NULL,
        is_human INTEGER NOT NULL,
        content TEXT NOT NULL,
        mentions TEXT NOT NULL,
        reply_to_id TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        created_by_agent TEXT NOT NULL,
        created_by_author TEXT NOT NULL,
        assigned_to_agent TEXT,
        assigned_to_author TEXT,
        result_notes TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS resource_locks (
        resource_path TEXT PRIMARY KEY,
        locked_by_agent TEXT NOT NULL,
        locked_by_author TEXT NOT NULL,
        reason TEXT NOT NULL,
        locked_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS shared_context (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        description TEXT,
        updated_by_agent TEXT NOT NULL,
        updated_by_author TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        file_type TEXT NOT NULL,
        description TEXT NOT NULL,
        content TEXT NOT NULL,
        created_by_agent TEXT NOT NULL,
        created_by_author TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    // Seed default channels
    const defaultChannels = [
      { name: 'general', description: 'General team discussion & announcements' },
      { name: 'architecture', description: 'System design, RFCs, and tech stack decisions' },
      { name: 'api-contracts', description: 'Endpoints, data models, and API interfaces' },
      { name: 'frontend', description: 'UI components, UX flows, and state management' },
      { name: 'backend', description: 'Database, server routes, business logic, integrations' },
      { name: 'blockers', description: 'Urgent issues, blockers, and help requests' },
    ];

    const insertChannel = this.db.prepare(`
      INSERT OR IGNORE INTO channels (id, name, description, created_at)
      VALUES (?, ?, ?, ?)
    `);

    for (const ch of defaultChannels) {
      insertChannel.run(ch.name, ch.name, ch.description, Date.now());
    }
  }

  // --- Agents ---
  upsertAgent(agent: Agent): void {
    const stmt = this.db.prepare(`
      INSERT INTO agents (id, name, author, model, capabilities, status, current_task, last_heartbeat, ip)
      VALUES (@id, @name, @author, @model, @capabilities, @status, @currentTask, @lastHeartbeat, @ip)
      ON CONFLICT(name) DO UPDATE SET
        id = @id,
        author = @author,
        model = @model,
        capabilities = @capabilities,
        status = @status,
        current_task = @currentTask,
        last_heartbeat = @lastHeartbeat,
        ip = @ip
    `);
    stmt.run({
      id: agent.id,
      name: agent.name,
      author: agent.author,
      model: agent.model,
      capabilities: JSON.stringify(agent.capabilities || []),
      status: agent.status,
      currentTask: agent.currentTask || null,
      lastHeartbeat: agent.lastHeartbeat,
      ip: agent.ip || null,
    });
  }

  getAgents(): Agent[] {
    const rows = this.db.prepare('SELECT * FROM agents ORDER BY last_heartbeat DESC').all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      author: r.author,
      model: r.model,
      capabilities: JSON.parse(r.capabilities || '[]'),
      status: r.status,
      currentTask: r.current_task || undefined,
      lastHeartbeat: r.last_heartbeat,
      ip: r.ip || undefined,
    }));
  }

  getAgentByName(name: string): Agent | undefined {
    const r = this.db.prepare('SELECT * FROM agents WHERE name = ?').get(name) as any;
    if (!r) return undefined;
    return {
      id: r.id,
      name: r.name,
      author: r.author,
      model: r.model,
      capabilities: JSON.parse(r.capabilities || '[]'),
      status: r.status,
      currentTask: r.current_task || undefined,
      lastHeartbeat: r.last_heartbeat,
      ip: r.ip || undefined,
    };
  }

  updateAgentHeartbeat(id: string, currentTask?: string): void {
    if (currentTask !== undefined) {
      this.db
        .prepare('UPDATE agents SET last_heartbeat = ?, current_task = ?, status = ? WHERE id = ?')
        .run(Date.now(), currentTask, 'busy', id);
    } else {
      this.db.prepare('UPDATE agents SET last_heartbeat = ? WHERE id = ?').run(Date.now(), id);
    }
  }

  // --- Channels ---
  getChannels(): Channel[] {
    return this.db.prepare('SELECT * FROM channels ORDER BY name ASC').all() as Channel[];
  }

  createChannel(name: string, description: string): Channel {
    const cleanName = name.replace(/^#/, '').toLowerCase();
    const id = cleanName;
    const now = Date.now();
    this.db
      .prepare('INSERT OR REPLACE INTO channels (id, name, description, created_at) VALUES (?, ?, ?, ?)')
      .run(id, cleanName, description, now);
    return { id, name: cleanName, description, created_at: now };
  }

  // --- Messages ---
  addMessage(msg: Message): void {
    const cleanChannel = msg.channel.replace(/^#/, '').toLowerCase();
    const stmt = this.db.prepare(`
      INSERT INTO messages (id, channel, from_agent_id, from_agent_name, from_author, is_human, content, mentions, reply_to_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      msg.id,
      cleanChannel,
      msg.from_agent_id,
      msg.from_agent_name,
      msg.from_author,
      msg.is_human ? 1 : 0,
      msg.content,
      JSON.stringify(msg.mentions || []),
      msg.reply_to_id || null,
      msg.created_at
    );
  }

  getMessages(channel?: string, limit: number = 50, since?: number): Message[] {
    let query = 'SELECT * FROM messages';
    const params: any[] = [];
    const conditions: string[] = [];

    if (channel) {
      conditions.push('channel = ?');
      params.push(channel.replace(/^#/, '').toLowerCase());
    }
    if (since) {
      conditions.push('created_at > ?');
      params.push(since);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.reverse().map((r) => ({
      id: r.id,
      channel: r.channel,
      from_agent_id: r.from_agent_id,
      from_agent_name: r.from_agent_name,
      from_author: r.from_author,
      is_human: r.is_human === 1,
      content: r.content,
      mentions: JSON.parse(r.mentions || '[]'),
      reply_to_id: r.reply_to_id || undefined,
      created_at: r.created_at,
    }));
  }

  // --- Tasks ---
  createTask(task: Task): void {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, title, description, status, priority, created_by_agent, created_by_author, assigned_to_agent, assigned_to_author, result_notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      task.id,
      task.title,
      task.description,
      task.status,
      task.priority,
      task.created_by_agent,
      task.created_by_author,
      task.assigned_to_agent || null,
      task.assigned_to_author || null,
      task.result_notes || null,
      task.created_at,
      task.updated_at
    );
  }

  getTasks(status?: string): Task[] {
    let query = 'SELECT * FROM tasks';
    const params: any[] = [];
    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }
    query += ' ORDER BY created_at ASC';
    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      status: r.status,
      priority: r.priority,
      created_by_agent: r.created_by_agent,
      created_by_author: r.created_by_author,
      assigned_to_agent: r.assigned_to_agent || undefined,
      assigned_to_author: r.assigned_to_author || undefined,
      result_notes: r.result_notes || undefined,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
  }

  getTaskById(id: string): Task | undefined {
    const r = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;
    if (!r) return undefined;
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      status: r.status,
      priority: r.priority,
      created_by_agent: r.created_by_agent,
      created_by_author: r.created_by_author,
      assigned_to_agent: r.assigned_to_agent || undefined,
      assigned_to_author: r.assigned_to_author || undefined,
      result_notes: r.result_notes || undefined,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }

  updateTask(
    id: string,
    updates: Partial<Pick<Task, 'status' | 'assigned_to_agent' | 'assigned_to_author' | 'result_notes' | 'title' | 'description' | 'priority'>>
  ): Task | undefined {
    const existing = this.getTaskById(id);
    if (!existing) return undefined;

    const updated: Task = {
      ...existing,
      ...updates,
      updated_at: Date.now(),
    };

    this.db
      .prepare(`
      UPDATE tasks SET
        title = ?,
        description = ?,
        status = ?,
        priority = ?,
        assigned_to_agent = ?,
        assigned_to_author = ?,
        result_notes = ?,
        updated_at = ?
      WHERE id = ?
    `)
      .run(
        updated.title,
        updated.description,
        updated.status,
        updated.priority,
        updated.assigned_to_agent || null,
        updated.assigned_to_author || null,
        updated.result_notes || null,
        updated.updated_at,
        id
      );

    return updated;
  }

  deleteTask(id: string): boolean {
    const res = this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    return res.changes > 0;
  }

  // --- Resource Locks ---
  acquireLock(lock: ResourceLock): { success: boolean; existingLock?: ResourceLock } {
    this.cleanExpiredLocks();
    const existing = this.getLock(lock.resource_path);
    if (existing) {
      if (existing.locked_by_agent === lock.locked_by_agent) {
        // Renew lock
        this.db
          .prepare(
            'UPDATE resource_locks SET reason = ?, locked_at = ?, expires_at = ? WHERE resource_path = ?'
          )
          .run(lock.reason, lock.locked_at, lock.expires_at, lock.resource_path);
        return { success: true };
      }
      return { success: false, existingLock: existing };
    }

    this.db
      .prepare(`
      INSERT INTO resource_locks (resource_path, locked_by_agent, locked_by_author, reason, locked_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
      .run(
        lock.resource_path,
        lock.locked_by_agent,
        lock.locked_by_author,
        lock.reason,
        lock.locked_at,
        lock.expires_at
      );

    return { success: true };
  }

  releaseLock(resourcePath: string, agentName?: string): boolean {
    let stmt;
    if (agentName) {
      stmt = this.db.prepare('DELETE FROM resource_locks WHERE resource_path = ? AND locked_by_agent = ?').run(resourcePath, agentName);
    } else {
      stmt = this.db.prepare('DELETE FROM resource_locks WHERE resource_path = ?').run(resourcePath);
    }
    return stmt.changes > 0;
  }

  getLock(resourcePath: string): ResourceLock | undefined {
    return this.db.prepare('SELECT * FROM resource_locks WHERE resource_path = ?').get(resourcePath) as ResourceLock | undefined;
  }

  getAllLocks(): ResourceLock[] {
    this.cleanExpiredLocks();
    return this.db.prepare('SELECT * FROM resource_locks ORDER BY locked_at DESC').all() as ResourceLock[];
  }

  cleanExpiredLocks(): number {
    const res = this.db.prepare('DELETE FROM resource_locks WHERE expires_at < ?').run(Date.now());
    return res.changes;
  }

  // --- Shared Context (Key-Value) ---
  setContext(ctx: SharedContext): void {
    this.db
      .prepare(`
      INSERT INTO shared_context (key, value, description, updated_by_agent, updated_by_author, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        description = excluded.description,
        updated_by_agent = excluded.updated_by_agent,
        updated_by_author = excluded.updated_by_author,
        updated_at = excluded.updated_at
    `)
      .run(ctx.key, ctx.value, ctx.description || null, ctx.updated_by_agent, ctx.updated_by_author, ctx.updated_at);
  }

  getContext(key: string): SharedContext | undefined {
    return this.db.prepare('SELECT * FROM shared_context WHERE key = ?').get(key) as SharedContext | undefined;
  }

  getAllContext(): SharedContext[] {
    return this.db.prepare('SELECT * FROM shared_context ORDER BY key ASC').all() as SharedContext[];
  }

  deleteContext(key: string): boolean {
    const res = this.db.prepare('DELETE FROM shared_context WHERE key = ?').run(key);
    return res.changes > 0;
  }

  // --- Artifacts ---
  saveArtifact(artifact: Artifact): void {
    this.db
      .prepare(`
      INSERT INTO artifacts (id, name, file_type, description, content, created_by_agent, created_by_author, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        file_type = excluded.file_type,
        description = excluded.description,
        content = excluded.content,
        created_by_agent = excluded.created_by_agent,
        created_by_author = excluded.created_by_author,
        version = artifacts.version + 1,
        updated_at = excluded.updated_at
    `)
      .run(
        artifact.id,
        artifact.name,
        artifact.file_type,
        artifact.description,
        artifact.content,
        artifact.created_by_agent,
        artifact.created_by_author,
        artifact.version || 1,
        artifact.created_at,
        artifact.updated_at
      );
  }

  getArtifact(name: string): Artifact | undefined {
    return this.db.prepare('SELECT * FROM artifacts WHERE name = ?').get(name) as Artifact | undefined;
  }

  getAllArtifacts(): Artifact[] {
    return this.db.prepare('SELECT * FROM artifacts ORDER BY updated_at DESC').all() as Artifact[];
  }
}
