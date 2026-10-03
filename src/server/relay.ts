import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import { MeshDB } from '../db';
import { Agent, Message, Task, ResourceLock, SharedContext, Artifact, WSEvent } from '../types';
import { createPublicTunnel, TunnelResult } from './tunnel';

export interface RelayServerOptions {
  port?: number;
  dbPath?: string;
  enablePublicTunnel?: boolean;
}

export class MeshRelayServer {
  public app: express.Express;
  public server: http.Server;
  public wss: WebSocketServer;
  public db: MeshDB;
  public port: number;
  public startTime: number = Date.now();
  public tunnel?: TunnelResult;
  private wsClients: Set<WebSocket> = new Set();
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(options: RelayServerOptions = {}) {
    this.port = options.port || 8765;
    this.db = new MeshDB(options.dbPath);
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSockets();
    this.setupBackgroundTasks();
  }

  private setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json({ limit: '10mb' }));
  }

  public broadcast(event: WSEvent) {
    const data = JSON.stringify(event);
    for (const client of this.wsClients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(data);
        } catch (e) {
          // ignore closed socket errors
        }
      }
    }
  }

  private setupWebSockets() {
    this.wss.on('connection', (ws, req) => {
      this.wsClients.add(ws);

      // Send initial welcome & connected state
      ws.send(
        JSON.stringify({
          type: 'CONNECTED',
          payload: { message: 'Connected to AgentMesh Relay', timestamp: Date.now() },
          timestamp: Date.now(),
        })
      );

      ws.on('message', (rawData) => {
        try {
          const parsed = JSON.parse(rawData.toString());
          if (parsed.type === 'PING') {
            ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
          } else if (parsed.type === 'HEARTBEAT' && parsed.payload?.agentId) {
            this.db.updateAgentHeartbeat(parsed.payload.agentId, parsed.payload.currentTask);
          }
        } catch (err) {
          // ignore malformed message
        }
      });

      ws.on('close', () => {
        this.wsClients.delete(ws);
      });

      ws.on('error', () => {
        this.wsClients.delete(ws);
      });
    });
  }

  private setupBackgroundTasks() {
    // Check for offline agents and expired locks every 10 seconds
    this.heartbeatInterval = setInterval(() => {
      // Clean expired locks
      const cleaned = this.db.cleanExpiredLocks();
      if (cleaned > 0) {
        this.broadcast({
          type: 'LOCK_RELEASED',
          payload: { reason: 'expired', count: cleaned },
          timestamp: Date.now(),
        });
      }

      // Check agent heartbeats (offline if > 60s)
      const now = Date.now();
      const agents = this.db.getAgents();
      for (const agent of agents) {
        if (agent.status !== 'offline' && now - agent.lastHeartbeat > 60000) {
          agent.status = 'offline';
          this.db.upsertAgent(agent);
          this.broadcast({
            type: 'AGENT_DISCONNECTED',
            payload: agent,
            timestamp: Date.now(),
          });
        }
      }
    }, 10000);
  }

  private setupRoutes() {
    // Health / Status
    this.app.get('/api/health', (req, res) => {
      const agents = this.db.getAgents();
      const onlineAgents = agents.filter((a) => a.status !== 'offline');
      const locks = this.db.getAllLocks();
      const tasks = this.db.getTasks();
      res.json({
        status: 'ok',
        version: '1.0.0',
        uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
        stats: {
          onlineAgents: onlineAgents.length,
          totalAgents: agents.length,
          activeLocks: locks.length,
          openTasks: tasks.filter((t) => t.status === 'open' || t.status === 'in_progress').length,
          totalTasks: tasks.length,
        },
        publicUrl: this.tunnel?.url || null,
      });
    });

    // --- Agents ---
    this.app.post('/api/agents/register', (req, res) => {
      const { name, author, model, capabilities, status, currentTask } = req.body;
      if (!name || !author) {
        return res.status(400).json({ error: 'Missing name or author' });
      }

      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      const existing = this.db.getAgentByName(name);
      const agent: Agent = {
        id: existing?.id || uuidv4(),
        name,
        author,
        model: model || 'Unknown Model',
        capabilities: Array.isArray(capabilities) ? capabilities : ['coding'],
        status: status || 'idle',
        currentTask: currentTask || undefined,
        lastHeartbeat: Date.now(),
        ip: String(clientIp),
      };

      this.db.upsertAgent(agent);
      this.broadcast({
        type: 'AGENT_REGISTERED',
        payload: agent,
        timestamp: Date.now(),
      });

      res.json(agent);
    });

    this.app.post('/api/agents/heartbeat', (req, res) => {
      const { id, name, currentTask, status } = req.body;
      let agent: Agent | undefined;
      if (id) {
        const list = this.db.getAgents();
        agent = list.find((a) => a.id === id);
      } else if (name) {
        agent = this.db.getAgentByName(name);
      }

      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      agent.lastHeartbeat = Date.now();
      if (currentTask !== undefined) agent.currentTask = currentTask;
      if (status) agent.status = status;
      this.db.upsertAgent(agent);

      this.broadcast({
        type: 'AGENT_HEARTBEAT',
        payload: agent,
        timestamp: Date.now(),
      });

      res.json({ ok: true, agent });
    });

    this.app.get('/api/agents', (req, res) => {
      res.json(this.db.getAgents());
    });

    // --- Channels ---
    this.app.get('/api/channels', (req, res) => {
      res.json(this.db.getChannels());
    });

    this.app.post('/api/channels', (req, res) => {
      const { name, description } = req.body;
      if (!name) return res.status(400).json({ error: 'Channel name required' });
      const channel = this.db.createChannel(name, description || '');
      res.json(channel);
    });

    // --- Messages ---
    this.app.get('/api/messages', (req, res) => {
      const channel = req.query.channel as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const since = req.query.since ? parseInt(req.query.since as string, 10) : undefined;
      const msgs = this.db.getMessages(channel, limit, since);
      res.json(msgs);
    });

    this.app.post('/api/messages', (req, res) => {
      const { channel, from_agent_id, from_agent_name, from_author, is_human, content, mentions, reply_to_id } = req.body;
      if (!channel || !content) {
        return res.status(400).json({ error: 'Channel and content required' });
      }

      // Extract mentions like @AgentName
      const detectedMentions: string[] = [];
      const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
      let match;
      while ((match = mentionRegex.exec(content)) !== null) {
        detectedMentions.push(match[1]);
      }

      const msg: Message = {
        id: uuidv4(),
        channel: channel.replace(/^#/, '').toLowerCase(),
        from_agent_id: from_agent_id || 'human',
        from_agent_name: from_agent_name || from_author || 'Human',
        from_author: from_author || 'Anonymous',
        is_human: is_human ?? true,
        content,
        mentions: mentions || detectedMentions,
        reply_to_id: reply_to_id || undefined,
        created_at: Date.now(),
      };

      this.db.addMessage(msg);
      this.broadcast({
        type: 'MESSAGE_NEW',
        payload: msg,
        timestamp: Date.now(),
      });

      res.json(msg);
    });

    // --- Tasks ---
    this.app.get('/api/tasks', (req, res) => {
      const status = req.query.status as string | undefined;
      res.json(this.db.getTasks(status));
    });

    this.app.post('/api/tasks', (req, res) => {
      const { title, description, priority, created_by_agent, created_by_author, assigned_to_agent, assigned_to_author } = req.body;
      if (!title) return res.status(400).json({ error: 'Task title is required' });

      const task: Task = {
        id: uuidv4().slice(0, 8),
        title,
        description: description || '',
        status: assigned_to_agent ? 'in_progress' : 'open',
        priority: priority || 'medium',
        created_by_agent: created_by_agent || 'human',
        created_by_author: created_by_author || 'Anonymous',
        assigned_to_agent: assigned_to_agent || undefined,
        assigned_to_author: assigned_to_author || undefined,
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      this.db.createTask(task);
      this.broadcast({
        type: 'TASK_CREATED',
        payload: task,
        timestamp: Date.now(),
      });

      res.json(task);
    });

    this.app.get('/api/tasks/:id', (req, res) => {
      const task = this.db.getTaskById(req.params.id);
      if (!task) return res.status(404).json({ error: 'Task not found' });
      res.json(task);
    });

    this.app.patch('/api/tasks/:id', (req, res) => {
      const updated = this.db.updateTask(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: 'Task not found' });

      this.broadcast({
        type: 'TASK_UPDATED',
        payload: updated,
        timestamp: Date.now(),
      });

      res.json(updated);
    });

    this.app.delete('/api/tasks/:id', (req, res) => {
      const ok = this.db.deleteTask(req.params.id);
      if (!ok) return res.status(404).json({ error: 'Task not found' });

      this.broadcast({
        type: 'TASK_DELETED',
        payload: { id: req.params.id },
        timestamp: Date.now(),
      });

      res.json({ ok: true });
    });

    // --- Resource Locks ---
    this.app.get('/api/locks', (req, res) => {
      res.json(this.db.getAllLocks());
    });

    this.app.post('/api/locks/acquire', (req, res) => {
      const { resource_path, locked_by_agent, locked_by_author, reason, ttlMinutes } = req.body;
      if (!resource_path || !locked_by_agent) {
        return res.status(400).json({ error: 'resource_path and locked_by_agent are required' });
      }

      const ttlMs = (ttlMinutes || 15) * 60 * 1000;
      const now = Date.now();
      const lock: ResourceLock = {
        resource_path,
        locked_by_agent,
        locked_by_author: locked_by_author || locked_by_agent,
        reason: reason || 'Working on this resource',
        locked_at: now,
        expires_at: now + ttlMs,
      };

      const result = this.db.acquireLock(lock);
      if (!result.success) {
        return res.status(409).json({
          error: 'Resource is locked by another agent',
          existingLock: result.existingLock,
        });
      }

      this.broadcast({
        type: 'LOCK_ACQUIRED',
        payload: lock,
        timestamp: Date.now(),
      });

      res.json({ success: true, lock });
    });

    this.app.post('/api/locks/release', (req, res) => {
      const { resource_path, agent_name } = req.body;
      if (!resource_path) return res.status(400).json({ error: 'resource_path required' });

      const ok = this.db.releaseLock(resource_path, agent_name);
      this.broadcast({
        type: 'LOCK_RELEASED',
        payload: { resource_path, agent_name },
        timestamp: Date.now(),
      });

      res.json({ success: ok });
    });

    // --- Shared Context (Blackboard) ---
    this.app.get('/api/context', (req, res) => {
      res.json(this.db.getAllContext());
    });

    this.app.get('/api/context/:key', (req, res) => {
      const item = this.db.getContext(req.params.key);
      if (!item) return res.status(404).json({ error: 'Context key not found' });
      res.json(item);
    });

    this.app.post('/api/context', (req, res) => {
      const { key, value, description, updated_by_agent, updated_by_author } = req.body;
      if (!key || value === undefined) {
        return res.status(400).json({ error: 'key and value are required' });
      }

      const ctx: SharedContext = {
        key,
        value: typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value),
        description: description || undefined,
        updated_by_agent: updated_by_agent || 'human',
        updated_by_author: updated_by_author || 'Anonymous',
        updated_at: Date.now(),
      };

      this.db.setContext(ctx);
      this.broadcast({
        type: 'CONTEXT_UPDATED',
        payload: ctx,
        timestamp: Date.now(),
      });

      res.json(ctx);
    });

    this.app.delete('/api/context/:key', (req, res) => {
      const ok = this.db.deleteContext(req.params.key);
      if (!ok) return res.status(404).json({ error: 'Key not found' });

      this.broadcast({
        type: 'CONTEXT_DELETED',
        payload: { key: req.params.key },
        timestamp: Date.now(),
      });

      res.json({ ok: true });
    });

    // --- Artifacts ---
    this.app.get('/api/artifacts', (req, res) => {
      res.json(this.db.getAllArtifacts());
    });

    this.app.get('/api/artifacts/:name', (req, res) => {
      const artifact = this.db.getArtifact(req.params.name);
      if (!artifact) return res.status(404).json({ error: 'Artifact not found' });
      res.json(artifact);
    });

    this.app.post('/api/artifacts', (req, res) => {
      const { name, file_type, description, content, created_by_agent, created_by_author } = req.body;
      if (!name || !content) {
        return res.status(400).json({ error: 'name and content are required' });
      }

      const existing = this.db.getArtifact(name);
      const now = Date.now();
      const artifact: Artifact = {
        id: existing?.id || uuidv4(),
        name,
        file_type: file_type || 'text',
        description: description || '',
        content,
        created_by_agent: created_by_agent || 'human',
        created_by_author: created_by_author || 'Anonymous',
        version: (existing?.version || 0) + 1,
        created_at: existing?.created_at || now,
        updated_at: now,
      };

      this.db.saveArtifact(artifact);
      this.broadcast({
        type: existing ? 'ARTIFACT_UPDATED' : 'ARTIFACT_CREATED',
        payload: artifact,
        timestamp: Date.now(),
      });

      res.json(artifact);
    });
  }

  public async start(enableTunnel: boolean = false): Promise<{ localUrl: string; lanUrl: string; publicUrl?: string }> {
    return new Promise((resolve) => {
      this.server.listen(this.port, async () => {
        const localUrl = `http://localhost:${this.port}`;

        // Get local network IP
        let lanIp = 'localhost';
        const nets = os.networkInterfaces();
        for (const name of Object.keys(nets)) {
          for (const net of nets[name] || []) {
            if (net.family === 'IPv4' && !net.internal) {
              lanIp = net.address;
              break;
            }
          }
        }
        const lanUrl = `http://${lanIp}:${this.port}`;

        let publicUrl: string | undefined;
        if (enableTunnel) {
          try {
            this.tunnel = await createPublicTunnel(this.port);
            publicUrl = this.tunnel.url;
          } catch (err: any) {
            console.error('Warning: Failed to create public WAN tunnel:', err.message);
          }
        }

        resolve({ localUrl, lanUrl, publicUrl });
      });
    });
  }

  public async stop(): Promise<void> {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.tunnel) {
      await this.tunnel.close();
    }
    this.wss.close();
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }
}
