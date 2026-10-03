#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import boxen from 'boxen';
import Table from 'cli-table3';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { MeshRelayServer } from '../server/relay';
import { MeshClient } from '../client/api-client';
import { MeshTUI } from '../tui/dashboard';
import { startMCPServer } from '../mcp/server';

dotenv.config();

const program = new Command();

program
  .name('agent-mesh')
  .description('Terminal Multi-Agent Coordination Mesh for Distributed Hackathon Teams')
  .version('1.0.0');

// Helper to get default client options
function getClient(options: { hub?: string; agent?: string; author?: string; model?: string }) {
  const hubUrl = options.hub || process.env.AGENT_MESH_URL || 'http://localhost:8765';
  const agentName = options.agent || process.env.AGENT_NAME || 'CLI-Agent';
  const authorName = options.author || process.env.AGENT_AUTHOR || 'Human';
  const model = options.model || process.env.AGENT_MODEL || 'Manual-CLI';
  return new MeshClient({ hubUrl, agentName, authorName, model });
}

// -------------------------------------------------------------
// COMMAND: HOST (Start the Mesh Server + WAN Tunnel)
// -------------------------------------------------------------
program
  .command('host')
  .description('Start the AgentMesh relay server (and WAN public tunnel for cross-network colleagues)')
  .option('-p, --port <number>', 'Port to listen on', '8765')
  .option('--public', 'Automatically create a public WAN tunnel via Cloudflare', true)
  .option('--no-public', 'Disable public tunnel (LAN / Localhost only)')
  .action(async (opts) => {
    const port = parseInt(opts.port, 10);
    const server = new MeshRelayServer({ port });

    console.log(chalk.cyan('Starting AgentMesh Relay Server...'));
    const urls = await server.start(opts.public);

    const connectionInfo = [
      chalk.bold.green('✓ AgentMesh Relay Server is LIVE!'),
      '',
      `${chalk.bold('Localhost:')}    ${chalk.cyan(urls.localUrl)}`,
      `${chalk.bold('Local LAN:')}     ${chalk.cyan(urls.lanUrl)}`,
      urls.publicUrl
        ? `${chalk.bold.yellow('Public WAN Tunnel:')} ${chalk.bold.underline.green(urls.publicUrl)}  ${chalk.dim('(Accessible anywhere across networks)')}`
        : chalk.dim('Public tunnel: disabled (--no-public)'),
      '',
      chalk.bold('Teammate Join Command:'),
      chalk.hex('#F59E0B')(`  npx agent-mesh join ${urls.publicUrl || urls.lanUrl} --author "YourName" --agent "Agent-Name"`),
      '',
      chalk.bold('Launch Terminal TUI Dashboard:'),
      chalk.hex('#38BDF8')(`  npx agent-mesh tui --hub ${urls.publicUrl || urls.localUrl}`),
    ].join('\n');

    console.log(
      boxen(connectionInfo, {
        padding: 1,
        margin: 1,
        borderColor: 'cyan',
        borderStyle: 'round',
      })
    );

    console.log(chalk.dim('Press Ctrl+C to stop the relay server.\n'));
  });

// -------------------------------------------------------------
// COMMAND: JOIN (Verify Connection and Register)
// -------------------------------------------------------------
program
  .command('join <hubUrl>')
  .description('Join an existing AgentMesh relay server across the network')
  .option('-a, --agent <name>', 'Agent name', 'Agent-' + Math.floor(Math.random() * 1000))
  .option('-u, --author <name>', 'Your name / Colleague name', 'Teammate')
  .option('-m, --model <model>', 'AI Model identifier', 'Claude-3.7')
  .action(async (hubUrl, opts) => {
    try {
      console.log(chalk.cyan(`Connecting to AgentMesh at ${hubUrl}...`));
      const client = new MeshClient({
        hubUrl,
        agentName: opts.agent,
        authorName: opts.author,
        model: opts.model,
      });

      const health = await client.getHealth();
      const agent = await client.registerAgent('idle');

      console.log(
        boxen(
          [
            chalk.bold.green('✓ Successfully connected to AgentMesh!'),
            '',
            `${chalk.bold('Agent ID:')}      ${agent.id}`,
            `${chalk.bold('Agent Name:')}    ${agent.name}`,
            `${chalk.bold('Author:')}        ${agent.author}`,
            `${chalk.bold('Model:')}         ${agent.model}`,
            `${chalk.bold('Online Agents:')} ${health.stats.onlineAgents}`,
            `${chalk.bold('Active Locks:')}  ${health.stats.activeLocks}`,
            `${chalk.bold('Open Tasks:')}    ${health.stats.openTasks}`,
          ].join('\n'),
          { padding: 1, borderColor: 'green', borderStyle: 'round' }
        )
      );

      console.log(chalk.cyan(`\nTo launch the live Terminal Dashboard:\n  npx agent-mesh tui --hub ${hubUrl}\n`));
    } catch (err: any) {
      console.error(chalk.red(`\nFailed to join AgentMesh: ${err.message}`));
      process.exit(1);
    }
  });

// -------------------------------------------------------------
// COMMAND: TUI (Interactive Terminal Dashboard)
// -------------------------------------------------------------
program
  .command('tui')
  .description('Open the live interactive Terminal Mission Control Dashboard')
  .option('--hub <url>', 'AgentMesh relay server URL', process.env.AGENT_MESH_URL || 'http://localhost:8765')
  .option('-a, --agent <name>', 'Agent name', process.env.AGENT_NAME || 'Terminal-User')
  .option('-u, --author <name>', 'Author name', process.env.AGENT_AUTHOR || 'Human')
  .action(async (opts) => {
    try {
      const client = getClient(opts);
      const tui = new MeshTUI(client);
      await tui.start();
    } catch (err: any) {
      console.error(chalk.red(`Failed to start TUI: ${err.message}`));
      process.exit(1);
    }
  });

// -------------------------------------------------------------
// COMMAND: WATCH (Live Stream to stdout)
// -------------------------------------------------------------
program
  .command('watch')
  .description('Live stream messages and events directly to terminal stdout')
  .option('--hub <url>', 'AgentMesh relay server URL', process.env.AGENT_MESH_URL || 'http://localhost:8765')
  .option('-c, --channel <channel>', 'Filter by channel')
  .action(async (opts) => {
    const client = getClient(opts);
    console.log(chalk.cyan(`Streaming live AgentMesh events from ${client.hubUrl}... (Ctrl+C to stop)\n`));

    client.connectWebSocket((event) => {
      const time = new Date(event.timestamp).toLocaleTimeString();
      switch (event.type) {
        case 'MESSAGE_NEW':
          if (!opts.channel || opts.channel.replace(/^#/, '') === event.payload.channel) {
            console.log(
              `${chalk.gray(`[${time}]`)} ${chalk.hex('#818CF8')(`[#${event.payload.channel}]`)} ${chalk.bold.green(event.payload.from_agent_name)} (${event.payload.from_author}): ${event.payload.content}`
            );
          }
          break;
        case 'TASK_CREATED':
          console.log(`${chalk.gray(`[${time}]`)} ${chalk.yellow('📋 NEW TASK:')} [${event.payload.id}] ${event.payload.title}`);
          break;
        case 'TASK_UPDATED':
          console.log(`${chalk.gray(`[${time}]`)} ${chalk.yellow('⚡ TASK UPDATE:')} [${event.payload.id}] ${event.payload.title} -> ${chalk.bold(event.payload.status)}`);
          break;
        case 'LOCK_ACQUIRED':
          console.log(`${chalk.gray(`[${time}]`)} ${chalk.red('🔒 FILE LOCKED:')} ${event.payload.resource_path} by ${event.payload.locked_by_agent}`);
          break;
        case 'LOCK_RELEASED':
          console.log(`${chalk.gray(`[${time}]`)} ${chalk.green('🔓 FILE UNLOCKED:')} ${event.payload.resource_path || 'expired'}`);
          break;
        case 'AGENT_REGISTERED':
          console.log(`${chalk.gray(`[${time}]`)} ${chalk.blue('🤖 AGENT ONLINE:')} ${event.payload.name} (${event.payload.author})`);
          break;
      }
    });
  });

// -------------------------------------------------------------
// COMMAND: SEND (Post Message to Channel)
// -------------------------------------------------------------
program
  .command('send <channel> <message>')
  .description('Send a message to a channel (e.g. general, architecture, backend, frontend)')
  .option('--hub <url>', 'AgentMesh relay server URL')
  .option('-a, --agent <name>', 'Sender agent name')
  .option('-u, --author <name>', 'Sender author name')
  .action(async (channel, message, opts) => {
    try {
      const client = getClient(opts);
      const msg = await client.sendMessage(channel, message);
      console.log(chalk.green(`✓ Sent to #${msg.channel} (ID: ${msg.id})`));
    } catch (err: any) {
      console.error(chalk.red(`Error sending message: ${err.message}`));
      process.exit(1);
    }
  });

// -------------------------------------------------------------
// COMMAND: TASK (Kanban Management)
// -------------------------------------------------------------
const taskCmd = program.command('task').description('Manage shared tasks and backlog');

taskCmd
  .command('list')
  .description('List shared tasks')
  .option('-s, --status <status>', 'Filter status: open, in_progress, review, completed, blocked')
  .option('--hub <url>', 'Hub URL')
  .action(async (opts) => {
    const client = getClient(opts);
    const tasks = await client.getTasks(opts.status);

    const table = new Table({
      head: [chalk.cyan('ID'), chalk.cyan('Status'), chalk.cyan('Priority'), chalk.cyan('Title'), chalk.cyan('Assignee'), chalk.cyan('Author')],
      style: { head: [], border: ['gray'] },
    });

    for (const t of tasks) {
      table.push([
        chalk.dim(t.id),
        t.status === 'completed' ? chalk.green('DONE') : t.status === 'in_progress' ? chalk.yellow('IN_PROG') : chalk.blue(t.status.toUpperCase()),
        t.priority === 'urgent' || t.priority === 'high' ? chalk.red(t.priority.toUpperCase()) : chalk.dim(t.priority.toUpperCase()),
        t.title,
        t.assigned_to_agent ? chalk.green(t.assigned_to_agent) : chalk.dim('unassigned'),
        chalk.dim(t.created_by_author),
      ]);
    }

    console.log(table.toString());
  });

taskCmd
  .command('create <title>')
  .description('Create a new task')
  .option('-d, --desc <description>', 'Task description', '')
  .option('-p, --priority <priority>', 'Priority: low, medium, high, urgent', 'medium')
  .option('--assignee <agent>', 'Assign to agent')
  .option('--hub <url>', 'Hub URL')
  .action(async (title, opts) => {
    const client = getClient(opts);
    const task = await client.createTask(title, opts.desc, opts.priority as any, opts.assignee);
    console.log(chalk.green(`✓ Created task [${task.id}]: ${task.title}`));
  });

taskCmd
  .command('claim <taskId>')
  .description('Atomically claim a task')
  .option('--hub <url>', 'Hub URL')
  .action(async (taskId, opts) => {
    const client = getClient(opts);
    const task = await client.claimTask(taskId);
    console.log(chalk.green(`✓ Task [${task.id}] claimed by ${client.agentName}!`));
  });

taskCmd
  .command('update <taskId>')
  .description('Update task status')
  .option('-s, --status <status>', 'Status: open, in_progress, review, completed, blocked', 'completed')
  .option('-n, --notes <notes>', 'Result notes')
  .option('--hub <url>', 'Hub URL')
  .action(async (taskId, opts) => {
    const client = getClient(opts);
    const task = await client.updateTask(taskId, {
      status: opts.status as any,
      result_notes: opts.notes,
    });
    console.log(chalk.green(`✓ Task [${task.id}] updated to status: ${task.status}`));
  });

// -------------------------------------------------------------
// COMMAND: LOCK (Concurrency File Locks)
// -------------------------------------------------------------
const lockCmd = program.command('lock').description('Manage file and module concurrency locks');

lockCmd
  .command('list')
  .description('List all active file locks')
  .option('--hub <url>', 'Hub URL')
  .action(async (opts) => {
    const client = getClient(opts);
    const locks = await client.getLocks();

    const table = new Table({
      head: [chalk.cyan('Resource Path'), chalk.cyan('Locked By Agent'), chalk.cyan('Author'), chalk.cyan('Reason'), chalk.cyan('Expires In')],
      style: { head: [], border: ['gray'] },
    });

    if (locks.length === 0) {
      console.log(chalk.green('No files currently locked.'));
      return;
    }

    for (const l of locks) {
      const leftSec = Math.max(0, Math.floor((l.expires_at - Date.now()) / 1000));
      table.push([
        chalk.hex('#F59E0B')(l.resource_path),
        chalk.green(l.locked_by_agent),
        chalk.white(l.locked_by_author),
        chalk.dim(l.reason),
        chalk.red(`${Math.floor(leftSec / 60)}m ${leftSec % 60}s`),
      ]);
    }

    console.log(table.toString());
  });

lockCmd
  .command('acquire <resourcePath>')
  .description('Acquire a concurrency lock on a file or folder')
  .option('-r, --reason <reason>', 'Reason for locking', 'Editing file')
  .option('-t, --ttl <minutes>', 'TTL in minutes', '15')
  .option('--hub <url>', 'Hub URL')
  .action(async (resourcePath, opts) => {
    const client = getClient(opts);
    const res = await client.acquireLock(resourcePath, opts.reason, parseInt(opts.ttl, 10));
    if (res.success) {
      console.log(chalk.green(`✓ Lock acquired for "${resourcePath}". Safe to edit!`));
    } else {
      console.error(chalk.red(`✗ FAILED: "${resourcePath}" is already locked by ${res.lock?.locked_by_agent} (${res.lock?.locked_by_author}). Reason: "${res.lock?.reason}"`));
      process.exit(1);
    }
  });

lockCmd
  .command('release <resourcePath>')
  .description('Release a lock on a file or folder')
  .option('--hub <url>', 'Hub URL')
  .action(async (resourcePath, opts) => {
    const client = getClient(opts);
    await client.releaseLock(resourcePath);
    console.log(chalk.green(`✓ Lock released for "${resourcePath}".`));
  });

// -------------------------------------------------------------
// COMMAND: CONTEXT (Shared Blackboard)
// -------------------------------------------------------------
const contextCmd = program.command('context').description('Manage shared architectural knowledge and specs');

contextCmd
  .command('list')
  .description('List all shared context keys')
  .option('--hub <url>', 'Hub URL')
  .action(async (opts) => {
    const client = getClient(opts);
    const list = await client.getAllContext();
    const table = new Table({
      head: [chalk.cyan('Key'), chalk.cyan('Description'), chalk.cyan('Updated By'), chalk.cyan('Updated At')],
      style: { head: [], border: ['gray'] },
    });

    for (const c of list) {
      table.push([
        chalk.bold.cyan(c.key),
        chalk.white(c.description || '-'),
        chalk.dim(`${c.updated_by_agent} (${c.updated_by_author})`),
        chalk.dim(new Date(c.updated_at).toLocaleTimeString()),
      ]);
    }
    console.log(table.toString());
  });

contextCmd
  .command('get <key>')
  .description('Get the full value of a shared context key')
  .option('--hub <url>', 'Hub URL')
  .action(async (key, opts) => {
    const client = getClient(opts);
    try {
      const ctx = await client.getContext(key);
      console.log(chalk.bold.cyan(`\n=== Context: ${ctx.key} (by ${ctx.updated_by_agent}) ===\n`));
      console.log(ctx.value);
      console.log();
    } catch (err: any) {
      console.error(chalk.red(`Key not found: ${key}`));
      process.exit(1);
    }
  });

contextCmd
  .command('set <key> <value>')
  .description('Set a shared context key (e.g. database schema, API contracts, environment vars)')
  .option('-d, --desc <description>', 'Description of this spec')
  .option('--file <filePath>', 'Read value from a local file')
  .option('--hub <url>', 'Hub URL')
  .action(async (key, value, opts) => {
    const client = getClient(opts);
    let finalValue = value;
    if (opts.file) {
      finalValue = fs.readFileSync(path.resolve(opts.file), 'utf8');
    }
    const ctx = await client.setContext(key, finalValue, opts.desc);
    console.log(chalk.green(`✓ Context key "${ctx.key}" saved successfully!`));
  });

// -------------------------------------------------------------
// COMMAND: ARTIFACT (Share Files & Diffs)
// -------------------------------------------------------------
const artifactCmd = program.command('artifact').description('Share code snippets and artifacts');

artifactCmd
  .command('push <name>')
  .description('Upload a local file or code snippet as a shared artifact')
  .requiredOption('-f, --file <filePath>', 'Path to file')
  .option('-t, --type <fileType>', 'File type (e.g. ts, py, sql, json)')
  .option('-d, --desc <description>', 'Description')
  .option('--hub <url>', 'Hub URL')
  .action(async (name, opts) => {
    const client = getClient(opts);
    const content = fs.readFileSync(path.resolve(opts.file), 'utf8');
    const ext = opts.type || path.extname(opts.file).replace(/^\./, '') || 'text';
    const art = await client.shareArtifact(name, content, ext, opts.desc);
    console.log(chalk.green(`✓ Published artifact "${art.name}" (v${art.version}, ${art.file_type})`));
  });

artifactCmd
  .command('pull <name>')
  .description('Download a shared artifact')
  .option('-o, --out <filePath>', 'Save to local file')
  .option('--hub <url>', 'Hub URL')
  .action(async (name, opts) => {
    const client = getClient(opts);
    const art = await client.getArtifact(name);
    if (opts.out) {
      fs.writeFileSync(path.resolve(opts.out), art.content, 'utf8');
      console.log(chalk.green(`✓ Saved artifact "${art.name}" to ${opts.out}`));
    } else {
      console.log(chalk.bold.cyan(`\n=== Artifact: ${art.name} (v${art.version}) ===\n`));
      console.log(art.content);
      console.log();
    }
  });

// -------------------------------------------------------------
// COMMAND: AGENTS (Fleet Presence)
// -------------------------------------------------------------
program
  .command('agents')
  .description('List all online and registered AI agents across the team')
  .option('--hub <url>', 'Hub URL')
  .action(async (opts) => {
    const client = getClient(opts);
    const list = await client.getAgents();

    const table = new Table({
      head: [chalk.cyan('Agent Name'), chalk.cyan('Status'), chalk.cyan('Author / Colleague'), chalk.cyan('Model'), chalk.cyan('Current Task'), chalk.cyan('Last Seen')],
      style: { head: [], border: ['gray'] },
    });

    for (const a of list) {
      const isOnline = a.status !== 'offline';
      const statusIcon = isOnline ? (a.status === 'busy' ? chalk.yellow('● BUSY') : chalk.green('● IDLE')) : chalk.gray('○ OFFLINE');
      const timeDiff = Math.floor((Date.now() - a.lastHeartbeat) / 1000);
      const lastSeen = timeDiff < 60 ? `${timeDiff}s ago` : `${Math.floor(timeDiff / 60)}m ago`;

      table.push([
        chalk.bold.hex(isOnline ? '#10B981' : '#6B7280')(a.name),
        statusIcon,
        chalk.white(a.author),
        chalk.dim(a.model),
        a.currentTask ? chalk.yellow(a.currentTask) : chalk.dim('-'),
        chalk.dim(lastSeen),
      ]);
    }
    console.log(table.toString());
  });

// -------------------------------------------------------------
// COMMAND: STATUS (Health Check)
// -------------------------------------------------------------
program
  .command('status')
  .description('Show AgentMesh relay server health and stats')
  .option('--hub <url>', 'Hub URL')
  .action(async (opts) => {
    const client = getClient(opts);
    try {
      const health = await client.getHealth();
      console.log(
        boxen(
          [
            chalk.bold.green('✓ AgentMesh Relay Status: OK'),
            '',
            `${chalk.bold('Hub URL:')}       ${client.hubUrl}`,
            `${chalk.bold('Uptime:')}        ${health.uptimeSeconds}s`,
            `${chalk.bold('Online Agents:')} ${health.stats.onlineAgents}`,
            `${chalk.bold('Active Locks:')}  ${health.stats.activeLocks}`,
            `${chalk.bold('Open Tasks:')}    ${health.stats.openTasks}`,
            `${chalk.bold('Total Tasks:')}   ${health.stats.totalTasks}`,
          ].join('\n'),
          { padding: 1, borderColor: 'cyan', borderStyle: 'round' }
        )
      );
    } catch (err: any) {
      console.error(chalk.red(`AgentMesh connection error: ${err.message}`));
      process.exit(1);
    }
  });

// -------------------------------------------------------------
// COMMAND: MCP (Start MCP Server)
// -------------------------------------------------------------
program
  .command('mcp')
  .description('Run standard MCP stdio server for Antigravity, Cursor, Claude Code, or Windsurf')
  .option('--hub <url>', 'Hub URL', process.env.AGENT_MESH_URL || 'http://localhost:8765')
  .option('-a, --agent <name>', 'Agent name', process.env.AGENT_NAME || 'MCP-Agent')
  .option('-u, --author <name>', 'Author name', process.env.AGENT_AUTHOR || 'Developer')
  .option('-m, --model <model>', 'Model name', process.env.AGENT_MODEL || 'LLM')
  .action(async (opts) => {
    await startMCPServer({
      hubUrl: opts.hub,
      agentName: opts.agent,
      authorName: opts.author,
      modelName: opts.model,
    });
  });

// -------------------------------------------------------------
// COMMAND: MCP-CONFIG (Print copy-paste config for editors)
// -------------------------------------------------------------
program
  .command('mcp-config')
  .description('Print ready-to-copy MCP configuration JSON for Cursor, Claude Code, Antigravity, and Windsurf')
  .option('--hub <url>', 'Hub URL', process.env.AGENT_MESH_URL || 'http://localhost:8765')
  .option('-a, --agent <name>', 'Agent name', 'MyCodingAgent')
  .option('-u, --author <name>', 'Your name', 'MyName')
  .action((opts) => {
    const cwd = process.cwd();
    const config = {
      mcpServers: {
        'agent-mesh': {
          command: 'npx',
          args: [
            'agent-mesh',
            'mcp',
            '--hub',
            opts.hub,
            '--agent',
            opts.agent,
            '--author',
            opts.author,
          ],
        },
      },
    };

    console.log(chalk.bold.green('\n=== Copy-Paste MCP Configuration for Claude Code / Cursor / Windsurf ===\n'));
    console.log(chalk.cyan(JSON.stringify(config, null, 2)));
    console.log(chalk.dim('\nAdd the above snippet to your .cursor/mcp.json or claude_desktop_config.json!\n'));
  });

program.parse(process.argv);
