import { WebSocket } from 'ws';
import { Agent, Message, Task, ResourceLock, SharedContext, Artifact, Channel, WSEvent } from '../types';

export interface MeshClientOptions {
  hubUrl: string;
  agentName?: string;
  authorName?: string;
  model?: string;
  capabilities?: string[];
}

export class MeshClient {
  public hubUrl: string;
  public agentName: string;
  public authorName: string;
  public model: string;
  public capabilities: string[];
  public currentAgent?: Agent;
  private ws?: WebSocket;
  private heartbeatTimer?: NodeJS.Timeout;
  private eventListeners: ((event: WSEvent) => void)[] = [];

  constructor(options: MeshClientOptions) {
    this.hubUrl = options.hubUrl.replace(/\/$/, '');
    this.agentName = options.agentName || 'Terminal-User';
    this.authorName = options.authorName || 'Human';
    this.model = options.model || 'Manual-CLI';
    this.capabilities = options.capabilities || ['cli', 'chat'];
  }

  private getHttpUrl(path: string): string {
    return `${this.hubUrl}${path}`;
  }

  private getWsUrl(): string {
    const isSsl = this.hubUrl.startsWith('https');
    const base = this.hubUrl.replace(/^http(s)?:\/\//, '');
    return `${isSsl ? 'wss' : 'ws'}://${base}/ws`;
  }

  // --- REST Calls ---
  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = this.getHttpUrl(path);
    const headers = {
      'Content-Type': 'application/json',
      ...((options.headers as any) || {}),
    };

    const res = await fetch(url, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const body = await res.text();
      let errorMsg = `HTTP ${res.status}: ${res.statusText}`;
      try {
        const json = JSON.parse(body);
        if (json.error) errorMsg = json.error;
      } catch {
        if (body) errorMsg = body;
      }
      throw new Error(errorMsg);
    }

    return res.json() as Promise<T>;
  }

  // --- Health & Stats ---
  async getHealth(): Promise<{ status: string; uptimeSeconds: number; stats: any; publicUrl?: string }> {
    return this.request('/api/health');
  }

  // --- Agents ---
  async registerAgent(status: 'idle' | 'busy' = 'idle', currentTask?: string): Promise<Agent> {
    const agent = await this.request<Agent>('/api/agents/register', {
      method: 'POST',
      body: JSON.stringify({
        name: this.agentName,
        author: this.authorName,
        model: this.model,
        capabilities: this.capabilities,
        status,
        currentTask,
      }),
    });
    this.currentAgent = agent;
    return agent;
  }

  async sendHeartbeat(currentTask?: string, status?: 'idle' | 'busy'): Promise<void> {
    if (!this.currentAgent) return;
    await this.request('/api/agents/heartbeat', {
      method: 'POST',
      body: JSON.stringify({
        id: this.currentAgent.id,
        name: this.agentName,
        currentTask,
        status,
      }),
    });
  }

  async getAgents(): Promise<Agent[]> {
    return this.request<Agent[]>('/api/agents');
  }

  // --- Channels ---
  async getChannels(): Promise<Channel[]> {
    return this.request<Channel[]>('/api/channels');
  }

  async createChannel(name: string, description: string = ''): Promise<Channel> {
    return this.request<Channel>('/api/channels', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    });
  }

  // --- Messages ---
  async getMessages(channel?: string, limit: number = 50, since?: number): Promise<Message[]> {
    let path = `/api/messages?limit=${limit}`;
    if (channel) path += `&channel=${encodeURIComponent(channel.replace(/^#/, ''))}`;
    if (since) path += `&since=${since}`;
    return this.request<Message[]>(path);
  }

  async sendMessage(channel: string, content: string, mentions?: string[], replyToId?: string): Promise<Message> {
    return this.request<Message>('/api/messages', {
      method: 'POST',
      body: JSON.stringify({
        channel,
        content,
        from_agent_id: this.currentAgent?.id || 'cli-user',
        from_agent_name: this.agentName,
        from_author: this.authorName,
        is_human: this.model === 'Manual-CLI' || this.model === 'Human',
        mentions,
        reply_to_id: replyToId,
      }),
    });
  }

  // --- Tasks ---
  async getTasks(status?: string): Promise<Task[]> {
    let path = '/api/tasks';
    if (status) path += `?status=${encodeURIComponent(status)}`;
    return this.request<Task[]>(path);
  }

  async createTask(title: string, description: string = '', priority: 'low' | 'medium' | 'high' | 'urgent' = 'medium', assignee?: string): Promise<Task> {
    return this.request<Task>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title,
        description,
        priority,
        created_by_agent: this.agentName,
        created_by_author: this.authorName,
        assigned_to_agent: assignee,
      }),
    });
  }

  async getTask(id: string): Promise<Task> {
    return this.request<Task>(`/api/tasks/${id}`);
  }

  async claimTask(id: string): Promise<Task> {
    return this.request<Task>(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'in_progress',
        assigned_to_agent: this.agentName,
        assigned_to_author: this.authorName,
      }),
    });
  }

  async updateTask(
    id: string,
    updates: {
      status?: 'open' | 'claimed' | 'in_progress' | 'review' | 'completed' | 'blocked';
      result_notes?: string;
      title?: string;
      description?: string;
      priority?: 'low' | 'medium' | 'high' | 'urgent';
    }
  ): Promise<Task> {
    return this.request<Task>(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async deleteTask(id: string): Promise<void> {
    await this.request(`/api/tasks/${id}`, { method: 'DELETE' });
  }

  // --- Resource Locks ---
  async getLocks(): Promise<ResourceLock[]> {
    return this.request<ResourceLock[]>('/api/locks');
  }

  async acquireLock(resourcePath: string, reason: string = 'Working on this file', ttlMinutes: number = 15): Promise<{ success: boolean; lock?: ResourceLock }> {
    return this.request<{ success: boolean; lock?: ResourceLock }>('/api/locks/acquire', {
      method: 'POST',
      body: JSON.stringify({
        resource_path: resourcePath,
        locked_by_agent: this.agentName,
        locked_by_author: this.authorName,
        reason,
        ttlMinutes,
      }),
    });
  }

  async releaseLock(resourcePath: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>('/api/locks/release', {
      method: 'POST',
      body: JSON.stringify({
        resource_path: resourcePath,
        agent_name: this.agentName,
      }),
    });
  }

  // --- Shared Context ---
  async getAllContext(): Promise<SharedContext[]> {
    return this.request<SharedContext[]>('/api/context');
  }

  async getContext(key: string): Promise<SharedContext> {
    return this.request<SharedContext>(`/api/context/${encodeURIComponent(key)}`);
  }

  async setContext(key: string, value: any, description?: string): Promise<SharedContext> {
    return this.request<SharedContext>('/api/context', {
      method: 'POST',
      body: JSON.stringify({
        key,
        value,
        description,
        updated_by_agent: this.agentName,
        updated_by_author: this.authorName,
      }),
    });
  }

  async deleteContext(key: string): Promise<void> {
    await this.request(`/api/context/${encodeURIComponent(key)}`, { method: 'DELETE' });
  }

  // --- Artifacts ---
  async getArtifacts(): Promise<Artifact[]> {
    return this.request<Artifact[]>('/api/artifacts');
  }

  async getArtifact(name: string): Promise<Artifact> {
    return this.request<Artifact>(`/api/artifacts/${encodeURIComponent(name)}`);
  }

  async shareArtifact(name: string, content: string, fileType: string = 'text', description: string = ''): Promise<Artifact> {
    return this.request<Artifact>('/api/artifacts', {
      method: 'POST',
      body: JSON.stringify({
        name,
        content,
        file_type: fileType,
        description,
        created_by_agent: this.agentName,
        created_by_author: this.authorName,
      }),
    });
  }

  // --- Real-Time WebSocket Connection ---
  connectWebSocket(onEvent?: (event: WSEvent) => void): WebSocket {
    if (onEvent) {
      this.eventListeners.push(onEvent);
    }

    const wsUrl = this.getWsUrl();
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      // Start heartbeat loop every 20s
      this.heartbeatTimer = setInterval(() => {
        if (this.currentAgent) {
          this.sendHeartbeat().catch(() => {});
        }
      }, 20000);
    });

    this.ws.on('message', (data) => {
      try {
        const event: WSEvent = JSON.parse(data.toString());
        for (const listener of this.eventListeners) {
          listener(event);
        }
      } catch (err) {
        // ignore parse error
      }
    });

    this.ws.on('close', () => {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    });

    return this.ws;
  }

  onEvent(listener: (event: WSEvent) => void) {
    this.eventListeners.push(listener);
  }

  disconnect() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.ws) {
      this.ws.close();
    }
  }
}
