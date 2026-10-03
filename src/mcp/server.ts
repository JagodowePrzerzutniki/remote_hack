import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { MeshClient } from '../client/api-client';

export interface MCPOptions {
  hubUrl: string;
  agentName: string;
  authorName: string;
  modelName?: string;
}

export async function startMCPServer(options: MCPOptions) {
  const client = new MeshClient({
    hubUrl: options.hubUrl,
    agentName: options.agentName,
    authorName: options.authorName,
    model: options.modelName || 'LLM-Agent',
    capabilities: ['mcp', 'coding', 'architecture'],
  });

  // Auto-register
  try {
    await client.registerAgent('idle');
  } catch (err: any) {
    console.error(`MCP Agent registration warning: ${err.message}`);
  }

  const server = new Server(
    {
      name: `agent-mesh-${options.agentName}`,
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List all available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'mesh_post_message',
          description:
            'Post a message to a team communication channel (e.g. #general, #architecture, #api-contracts, #frontend, #backend, #blockers). Use this to inform other agents and human teammates of your progress, ask questions, or propose changes.',
          inputSchema: {
            type: 'object',
            properties: {
              channel: {
                type: 'string',
                description: 'Channel name (e.g. "general", "architecture", "backend", "frontend", "api-contracts", "blockers")',
              },
              message: {
                type: 'string',
                description: 'The text content of your message or question.',
              },
              mentions: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional list of agent names to notify (e.g. ["BackendAgent", "Sarah"])',
              },
            },
            required: ['channel', 'message'],
          },
        },
        {
          name: 'mesh_read_messages',
          description: 'Read recent messages from a channel to stay aligned with team discussions and other agents.',
          inputSchema: {
            type: 'object',
            properties: {
              channel: {
                type: 'string',
                description: 'Channel name (optional, omit to read all channels)',
              },
              limit: {
                type: 'number',
                description: 'Number of recent messages to fetch (default: 20)',
              },
            },
          },
        },
        {
          name: 'mesh_list_tasks',
          description: 'List shared tasks on the project Kanban board to see what needs to be done and what others are working on.',
          inputSchema: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                enum: ['open', 'in_progress', 'review', 'completed', 'blocked'],
                description: 'Filter by task status',
              },
            },
          },
        },
        {
          name: 'mesh_create_task',
          description: 'Create a new task on the shared team board.',
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Concise task title' },
              description: { type: 'string', description: 'Detailed requirements or acceptance criteria' },
              priority: {
                type: 'string',
                enum: ['low', 'medium', 'high', 'urgent'],
                description: 'Task priority level',
              },
              assignee: { type: 'string', description: 'Optional agent name to assign to' },
            },
            required: ['title'],
          },
        },
        {
          name: 'mesh_claim_task',
          description: 'Atomically claim an open task so no other agent duplicates your work.',
          inputSchema: {
            type: 'object',
            properties: {
              task_id: { type: 'string', description: 'The 8-character ID of the task to claim' },
            },
            required: ['task_id'],
          },
        },
        {
          name: 'mesh_update_task',
          description: 'Update the progress or mark a task as completed or blocked.',
          inputSchema: {
            type: 'object',
            properties: {
              task_id: { type: 'string', description: 'The ID of the task' },
              status: {
                type: 'string',
                enum: ['open', 'in_progress', 'review', 'completed', 'blocked'],
                description: 'Updated status',
              },
              result_notes: {
                type: 'string',
                description: 'Summary of what was implemented or blocker description',
              },
            },
            required: ['task_id', 'status'],
          },
        },
        {
          name: 'mesh_acquire_lock',
          description:
            'Lock a file, directory, or component to prevent git merge conflicts while you are refactoring or writing code.',
          inputSchema: {
            type: 'object',
            properties: {
              resource_path: {
                type: 'string',
                description: 'Path of the file or module you are editing (e.g. "src/auth/jwt.ts" or "prisma/schema.prisma")',
              },
              reason: {
                type: 'string',
                description: 'Why you are locking this file',
              },
              ttl_minutes: {
                type: 'number',
                description: 'Lock expiration time in minutes (default: 15)',
              },
            },
            required: ['resource_path'],
          },
        },
        {
          name: 'mesh_release_lock',
          description: 'Release a file lock after you finish modifying and committing the file.',
          inputSchema: {
            type: 'object',
            properties: {
              resource_path: {
                type: 'string',
                description: 'The file path to unlock',
              },
            },
            required: ['resource_path'],
          },
        },
        {
          name: 'mesh_list_locks',
          description: 'View all active file locks across all agents on the team.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'mesh_get_context',
          description: 'Read a shared architecture decision, API contract, database schema, or environment spec from the blackboard.',
          inputSchema: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: 'The context key (e.g. "db_schema", "api_endpoints", "auth_spec", "env_vars")',
              },
            },
            required: ['key'],
          },
        },
        {
          name: 'mesh_set_context',
          description: 'Set or update a shared architectural specification or global configuration for all agents to see.',
          inputSchema: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: 'Unique key (e.g. "auth_contract", "db_models", "frontend_theme")',
              },
              value: {
                type: 'string',
                description: 'The content, schema, or JSON string',
              },
              description: {
                type: 'string',
                description: 'Optional description of what this specification is',
              },
            },
            required: ['key', 'value'],
          },
        },
        {
          name: 'mesh_list_context_keys',
          description: 'List all shared knowledge and context keys available on the team blackboard.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'mesh_share_artifact',
          description: 'Share a code snippet, SQL schema, or configuration file with other agents.',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Unique artifact name (e.g. "schema.sql", "user_routes.ts")',
              },
              content: {
                type: 'string',
                description: 'Full code or file content',
              },
              file_type: {
                type: 'string',
                description: 'File extension or language (e.g. "typescript", "sql", "json")',
              },
              description: {
                type: 'string',
                description: 'Brief description of what this artifact contains',
              },
            },
            required: ['name', 'content'],
          },
        },
        {
          name: 'mesh_get_artifact',
          description: 'Fetch the content of a shared artifact by name.',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Artifact name to fetch' },
            },
            required: ['name'],
          },
        },
        {
          name: 'mesh_get_online_agents',
          description: 'See what other AI agents and human colleagues are currently active and what they are working on.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    };
  });

  // Handle tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'mesh_post_message': {
          const { channel, message, mentions } = args as any;
          const msg = await client.sendMessage(channel, message, mentions);
          return {
            content: [{ type: 'text', text: `Message posted successfully to #${msg.channel} (ID: ${msg.id})` }],
          };
        }

        case 'mesh_read_messages': {
          const { channel, limit } = (args as any) || {};
          const msgs = await client.getMessages(channel, limit || 20);
          const formatted = msgs
            .map((m) => `[#${m.channel}] [${new Date(m.created_at).toLocaleTimeString()}] ${m.from_agent_name} (${m.from_author}): ${m.content}`)
            .join('\n');
          return {
            content: [{ type: 'text', text: formatted || 'No messages found.' }],
          };
        }

        case 'mesh_list_tasks': {
          const { status } = (args as any) || {};
          const tasks = await client.getTasks(status);
          const formatted = tasks
            .map(
              (t) =>
                `ID: ${t.id} | [${t.status.toUpperCase()}] [Pri: ${t.priority}] ${t.title} (Assigned: ${t.assigned_to_agent || 'none'})`
            )
            .join('\n');
          return {
            content: [{ type: 'text', text: formatted || 'No tasks found.' }],
          };
        }

        case 'mesh_create_task': {
          const { title, description, priority, assignee } = args as any;
          const task = await client.createTask(title, description, priority, assignee);
          return {
            content: [{ type: 'text', text: `Task created with ID: ${task.id} (${task.title})` }],
          };
        }

        case 'mesh_claim_task': {
          const { task_id } = args as any;
          const task = await client.claimTask(task_id);
          return {
            content: [{ type: 'text', text: `Task ${task_id} successfully claimed by ${client.agentName}!` }],
          };
        }

        case 'mesh_update_task': {
          const { task_id, status, result_notes } = args as any;
          const task = await client.updateTask(task_id, { status, result_notes });
          return {
            content: [{ type: 'text', text: `Task ${task_id} status updated to ${status}.` }],
          };
        }

        case 'mesh_acquire_lock': {
          const { resource_path, reason, ttl_minutes } = args as any;
          const res = await client.acquireLock(resource_path, reason, ttl_minutes);
          if (res.success) {
            return {
              content: [{ type: 'text', text: `Lock acquired for "${resource_path}". You can safely edit it.` }],
            };
          } else {
            return {
              content: [
                {
                  type: 'text',
                  text: `ERROR: "${resource_path}" is currently locked by ${res.lock?.locked_by_agent} (${res.lock?.locked_by_author}) for reason: "${res.lock?.reason}". Please coordinate in chat or wait until released.`,
                },
              ],
            };
          }
        }

        case 'mesh_release_lock': {
          const { resource_path } = args as any;
          await client.releaseLock(resource_path);
          return {
            content: [{ type: 'text', text: `Lock released for "${resource_path}".` }],
          };
        }

        case 'mesh_list_locks': {
          const locks = await client.getLocks();
          const formatted = locks
            .map((l) => `🔒 ${l.resource_path} - Locked by: ${l.locked_by_agent} (${l.locked_by_author}) - Reason: ${l.reason}`)
            .join('\n');
          return {
            content: [{ type: 'text', text: formatted || 'No active file locks.' }],
          };
        }

        case 'mesh_get_context': {
          const { key } = args as any;
          try {
            const ctx = await client.getContext(key);
            return {
              content: [{ type: 'text', text: `Context [${key}] (updated by ${ctx.updated_by_agent}):\n${ctx.value}` }],
            };
          } catch (e) {
            return {
              content: [{ type: 'text', text: `Context key "${key}" not found.` }],
            };
          }
        }

        case 'mesh_set_context': {
          const { key, value, description } = args as any;
          const ctx = await client.setContext(key, value, description);
          return {
            content: [{ type: 'text', text: `Context key "${key}" saved successfully.` }],
          };
        }

        case 'mesh_list_context_keys': {
          const all = await client.getAllContext();
          const formatted = all.map((c) => `- ${c.key}: ${c.description || '(no description)'}`).join('\n');
          return {
            content: [{ type: 'text', text: formatted || 'No context keys defined yet.' }],
          };
        }

        case 'mesh_share_artifact': {
          const { name, content, file_type, description } = args as any;
          const art = await client.shareArtifact(name, content, file_type, description);
          return {
            content: [{ type: 'text', text: `Artifact "${art.name}" (v${art.version}) published to the team.` }],
          };
        }

        case 'mesh_get_artifact': {
          const { name } = args as any;
          try {
            const art = await client.getArtifact(name);
            return {
              content: [
                {
                  type: 'text',
                  text: `Artifact: ${art.name} (v${art.version}, ${art.file_type})\nDescription: ${art.description}\nAuthor: ${art.created_by_author}\n\n${art.content}`,
                },
              ],
            };
          } catch (e) {
            return {
              content: [{ type: 'text', text: `Artifact "${name}" not found.` }],
            };
          }
        }

        case 'mesh_get_online_agents': {
          const agents = await client.getAgents();
          const formatted = agents
            .map(
              (a) =>
                `🤖 ${a.name} [${a.status.toUpperCase()}] | Author: ${a.author} | Model: ${a.model} | Task: ${a.currentTask || 'idle'}`
            )
            .join('\n');
          return {
            content: [{ type: 'text', text: formatted || 'No agents registered yet.' }],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Error executing ${name}: ${error.message}` }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
