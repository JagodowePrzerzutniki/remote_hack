export type AgentStatus = 'idle' | 'busy' | 'offline';
export type TaskStatus = 'open' | 'claimed' | 'in_progress' | 'review' | 'completed' | 'blocked';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Agent {
  id: string;
  name: string;
  author: string; // Colleague's name (e.g. "Kacper", "Sarah", "Alex")
  model: string;  // Model (e.g. "Gemini-3.7", "Claude-3.7", "GPT-4o", "DeepSeek-R1")
  capabilities: string[];
  status: AgentStatus;
  currentTask?: string;
  lastHeartbeat: number;
  ip?: string;
}

export interface Channel {
  id: string;
  name: string;
  description: string;
  created_at: number;
}

export interface Message {
  id: string;
  channel: string;
  from_agent_id: string;
  from_agent_name: string;
  from_author: string;
  is_human: boolean;
  content: string;
  mentions: string[];
  reply_to_id?: string;
  created_at: number;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  created_by_agent: string;
  created_by_author: string;
  assigned_to_agent?: string;
  assigned_to_author?: string;
  result_notes?: string;
  created_at: number;
  updated_at: number;
}

export interface ResourceLock {
  resource_path: string; // e.g. "src/auth/jwt.ts" or "database/migrations"
  locked_by_agent: string;
  locked_by_author: string;
  reason: string;
  locked_at: number;
  expires_at: number; // Unix timestamp ms
}

export interface SharedContext {
  key: string;
  value: string;
  description?: string;
  updated_by_agent: string;
  updated_by_author: string;
  updated_at: number;
}

export interface Artifact {
  id: string;
  name: string; // e.g. "auth_schema.sql" or "openapi_v1.json"
  file_type: string;
  description: string;
  content: string;
  created_by_agent: string;
  created_by_author: string;
  version: number;
  created_at: number;
  updated_at: number;
}

export type WSEventType =
  | 'AGENT_REGISTERED'
  | 'AGENT_HEARTBEAT'
  | 'AGENT_DISCONNECTED'
  | 'MESSAGE_NEW'
  | 'TASK_CREATED'
  | 'TASK_UPDATED'
  | 'TASK_DELETED'
  | 'LOCK_ACQUIRED'
  | 'LOCK_RELEASED'
  | 'CONTEXT_UPDATED'
  | 'CONTEXT_DELETED'
  | 'ARTIFACT_CREATED'
  | 'ARTIFACT_UPDATED';

export interface WSEvent<T = any> {
  type: WSEventType;
  payload: T;
  timestamp: number;
}
