import readline from 'readline';
import chalk from 'chalk';
import Table from 'cli-table3';
import { MeshClient } from '../client/api-client';
import { Agent, Message, Task, ResourceLock, SharedContext, Artifact, WSEvent } from '../types';

export class MeshTUI {
  private client: MeshClient;
  private currentTab: number = 1; // 1: Chat, 2: Tasks, 3: Agents, 4: Locks, 5: Context, 6: Artifacts
  private selectedChannel: string = 'general';
  private messages: Message[] = [];
  private tasks: Task[] = [];
  private agents: Agent[] = [];
  private locks: ResourceLock[] = [];
  private contexts: SharedContext[] = [];
  private artifacts: Artifact[] = [];
  private healthStats: any = {};
  private inputMode: boolean = false;
  private inputBuffer: string = '';
  private notificationMessage: string = '';
  private notificationTimer?: NodeJS.Timeout;
  private isRunning: boolean = true;
  private rl?: readline.Interface;

  constructor(client: MeshClient) {
    this.client = client;
  }

  public async start() {
    // Initial fetch
    await this.fetchAllData();

    // Register agent presence
    await this.client.registerAgent('idle');

    // Connect WebSocket for live updates
    this.client.connectWebSocket((event: WSEvent) => {
      this.handleWSEvent(event);
    });

    // Setup raw terminal input
    this.setupKeyboard();

    // Initial render
    this.render();

    // Periodic refresh
    setInterval(() => {
      if (this.isRunning && !this.inputMode) {
        this.fetchAllData().then(() => this.render());
      }
    }, 5000);
  }

  private handleWSEvent(event: WSEvent) {
    let notify = '';
    switch (event.type) {
      case 'MESSAGE_NEW':
        this.messages.push(event.payload);
        if (this.messages.length > 100) this.messages.shift();
        notify = `💬 [${event.payload.channel}] ${event.payload.from_agent_name}: ${event.payload.content.slice(0, 35)}`;
        break;
      case 'TASK_CREATED':
        this.tasks.push(event.payload);
        notify = `📋 New Task: ${event.payload.title}`;
        break;
      case 'TASK_UPDATED':
        this.tasks = this.tasks.map((t) => (t.id === event.payload.id ? event.payload : t));
        notify = `⚡ Task Updated: ${event.payload.title} -> ${event.payload.status}`;
        break;
      case 'LOCK_ACQUIRED':
        this.locks = this.locks.filter((l) => l.resource_path !== event.payload.resource_path);
        this.locks.push(event.payload);
        notify = `🔒 File Locked: ${event.payload.resource_path} by ${event.payload.locked_by_agent}`;
        break;
      case 'LOCK_RELEASED':
        this.locks = this.locks.filter((l) => l.resource_path !== event.payload.resource_path);
        notify = `🔓 File Released: ${event.payload.resource_path || 'expired'}`;
        break;
      case 'AGENT_REGISTERED':
        this.agents = this.agents.filter((a) => a.id !== event.payload.id);
        this.agents.push(event.payload);
        notify = `🤖 Agent Connected: ${event.payload.name} (${event.payload.author})`;
        break;
      case 'AGENT_DISCONNECTED':
        this.agents = this.agents.map((a) => (a.id === event.payload.id ? event.payload : a));
        notify = `💤 Agent Offline: ${event.payload.name}`;
        break;
      case 'CONTEXT_UPDATED':
        this.contexts = this.contexts.filter((c) => c.key !== event.payload.key);
        this.contexts.push(event.payload);
        notify = `📝 Context Updated: ${event.payload.key}`;
        break;
      case 'ARTIFACT_CREATED':
      case 'ARTIFACT_UPDATED':
        this.artifacts = this.artifacts.filter((a) => a.name !== event.payload.name);
        this.artifacts.push(event.payload);
        notify = `📦 Artifact: ${event.payload.name}`;
        break;
    }

    if (notify) {
      this.showNotification(notify);
    }

    if (!this.inputMode) {
      this.render();
    }
  }

  private showNotification(msg: string) {
    this.notificationMessage = msg;
    if (this.notificationTimer) clearTimeout(this.notificationTimer);
    this.notificationTimer = setTimeout(() => {
      this.notificationMessage = '';
      if (!this.inputMode) this.render();
    }, 4000);
  }

  private async fetchAllData() {
    try {
      const [messages, tasks, agents, locks, contexts, artifacts, health] = await Promise.all([
        this.client.getMessages(undefined, 60),
        this.client.getTasks(),
        this.client.getAgents(),
        this.client.getLocks(),
        this.client.getAllContext(),
        this.client.getArtifacts(),
        this.client.getHealth().catch(() => ({ stats: {}, uptimeSeconds: 0 })),
      ]);

      this.messages = messages;
      this.tasks = tasks;
      this.agents = agents;
      this.locks = locks;
      this.contexts = contexts;
      this.artifacts = artifacts;
      this.healthStats = health.stats || {};
    } catch (e) {
      // ignore transient fetch error
    }
  }

  private setupKeyboard() {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    readline.emitKeypressEvents(process.stdin);
    process.stdin.resume();

    process.stdin.on('keypress', async (str, key) => {
      if (this.inputMode) {
        if (key.name === 'return') {
          await this.handleCommandInput(this.inputBuffer);
          this.inputMode = false;
          this.inputBuffer = '';
          this.render();
        } else if (key.name === 'escape') {
          this.inputMode = false;
          this.inputBuffer = '';
          this.render();
        } else if (key.name === 'backspace') {
          this.inputBuffer = this.inputBuffer.slice(0, -1);
          this.renderInputPrompt();
        } else if (str && !key.ctrl && !key.meta) {
          this.inputBuffer += str;
          this.renderInputPrompt();
        }
        return;
      }

      // Normal navigation mode
      if (key.ctrl && key.name === 'c') {
        this.exit();
      } else if (key.name === 'q') {
        this.exit();
      } else if (key.name === '1' || str === '1') {
        this.currentTab = 1;
        this.render();
      } else if (key.name === '2' || str === '2') {
        this.currentTab = 2;
        this.render();
      } else if (key.name === '3' || str === '3') {
        this.currentTab = 3;
        this.render();
      } else if (key.name === '4' || str === '4') {
        this.currentTab = 4;
        this.render();
      } else if (key.name === '5' || str === '5') {
        this.currentTab = 5;
        this.render();
      } else if (key.name === '6' || str === '6') {
        this.currentTab = 6;
        this.render();
      } else if (key.name === 'tab') {
        this.currentTab = (this.currentTab % 6) + 1;
        this.render();
      } else if (key.name === 'r') {
        await this.fetchAllData();
        this.render();
      } else if (str === 'i' || str === ':' || str === '/') {
        this.inputMode = true;
        this.inputBuffer = str === '/' || str === ':' ? str : '';
        this.renderInputPrompt();
      } else if (key.name === 'c') {
        // Cycle channel
        const channels = ['general', 'architecture', 'api-contracts', 'frontend', 'backend', 'blockers'];
        const idx = channels.indexOf(this.selectedChannel);
        this.selectedChannel = channels[(idx + 1) % channels.length];
        this.render();
      }
    });
  }

  private async handleCommandInput(input: string) {
    const trimmed = input.trim();
    if (!trimmed) return;

    try {
      if (trimmed.startsWith('/send ') || trimmed.startsWith(':send ')) {
        const parts = trimmed.slice(6).trim().split(' ');
        const channel = parts[0];
        const content = parts.slice(1).join(' ');
        if (channel && content) {
          await this.client.sendMessage(channel, content);
          this.showNotification(`Sent message to #${channel}`);
        }
      } else if (trimmed.startsWith('/task ') || trimmed.startsWith(':task ')) {
        const title = trimmed.slice(6).trim();
        if (title) {
          await this.client.createTask(title);
          this.showNotification(`Created task: ${title}`);
        }
      } else if (trimmed.startsWith('/claim ') || trimmed.startsWith(':claim ')) {
        const taskId = trimmed.slice(7).trim();
        if (taskId) {
          await this.client.claimTask(taskId);
          this.showNotification(`Claimed task ${taskId}`);
        }
      } else if (trimmed.startsWith('/done ') || trimmed.startsWith(':done ')) {
        const taskId = trimmed.slice(6).trim();
        if (taskId) {
          await this.client.updateTask(taskId, { status: 'completed' });
          this.showNotification(`Completed task ${taskId}`);
        }
      } else if (trimmed.startsWith('/lock ') || trimmed.startsWith(':lock ')) {
        const path = trimmed.slice(6).trim();
        if (path) {
          const res = await this.client.acquireLock(path, 'Manual lock from TUI');
          if (res.success) {
            this.showNotification(`Locked ${path}`);
          } else {
            this.showNotification(`Failed: already locked`);
          }
        }
      } else if (trimmed.startsWith('/unlock ') || trimmed.startsWith(':unlock ')) {
        const path = trimmed.slice(8).trim();
        if (path) {
          await this.client.releaseLock(path);
          this.showNotification(`Released ${path}`);
        }
      } else {
        // Default: send chat message to current channel
        await this.client.sendMessage(this.selectedChannel, trimmed);
        this.showNotification(`Sent to #${this.selectedChannel}`);
      }
      await this.fetchAllData();
    } catch (err: any) {
      this.showNotification(`Error: ${err.message}`);
    }
  }

  private exit() {
    this.isRunning = false;
    this.client.disconnect();
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    console.clear();
    console.log(chalk.cyan('Disconnected from AgentMesh. Goodbye! 👋'));
    process.exit(0);
  }

  private render() {
    const width = process.stdout.columns || 100;
    const lines: string[] = [];

    // Clear screen
    lines.push('\x1b[2J\x1b[H');

    // Header Bar
    lines.push(this.renderHeader(width));

    // Nav Tabs
    lines.push(this.renderTabs());

    // Notification Bar
    if (this.notificationMessage) {
      lines.push(chalk.bgCyan.black.bold(` ⚡ NOTICE: ${this.notificationMessage.padEnd(width - 15)} `));
    } else {
      lines.push(chalk.gray('─'.repeat(width)));
    }

    // Main Content Panel based on Current Tab
    switch (this.currentTab) {
      case 1:
        lines.push(this.renderChatView(width));
        break;
      case 2:
        lines.push(this.renderTaskBoard(width));
        break;
      case 3:
        lines.push(this.renderAgentFleet(width));
        break;
      case 4:
        lines.push(this.renderResourceLocks(width));
        break;
      case 5:
        lines.push(this.renderSharedContext(width));
        break;
      case 6:
        lines.push(this.renderArtifacts(width));
        break;
    }

    // Footer Help Bar
    lines.push(this.renderFooter(width));

    process.stdout.write(lines.join('\n'));

    if (this.inputMode) {
      this.renderInputPrompt();
    }
  }

  private renderHeader(width: number): string {
    const title = chalk.bold.hex('#00FFCC')(' AGENT MESH ') + chalk.dim('│ Distributed Multi-Agent Hub');
    const onlineCount = this.agents.filter((a) => a.status !== 'offline').length;
    const stats = `${chalk.green('●')} ${onlineCount} Agents Online  ${chalk.yellow('🔒')} ${this.locks.length} Locks  ${chalk.blue('📋')} ${this.tasks.filter((t) => t.status !== 'completed').length} Tasks`;
    const url = chalk.dim(`[${this.client.hubUrl}]`);

    return `${title}   ${stats}   ${url}`;
  }

  private renderTabs(): string {
    const tabs = [
      { id: 1, label: '1: Live Chat / Feed' },
      { id: 2, label: '2: Task Board' },
      { id: 3, label: '3: Agent Fleet' },
      { id: 4, label: '4: File Locks' },
      { id: 5, label: '5: Knowledge Context' },
      { id: 6, label: '6: Shared Artifacts' },
    ];

    return tabs
      .map((t) => {
        if (t.id === this.currentTab) {
          return chalk.bgHex('#6366F1').white.bold(` [${t.label}] `);
        }
        return chalk.dim.gray(`  ${t.label}  `);
      })
      .join(chalk.gray('│'));
  }

  private renderFooter(width: number): string {
    const keys = [
      `${chalk.bold('[1-6]')} Switch Tab`,
      `${chalk.bold('[Tab]')} Next Tab`,
      `${chalk.bold('[c]')} Channel: #${this.selectedChannel}`,
      `${chalk.bold('[i]')} Type Message`,
      `${chalk.bold('[r]')} Refresh`,
      `${chalk.bold('[q]')} Exit`,
    ];
    return chalk.bgHex('#1F2937').hex('#9CA3AF')(` ${keys.join('  │  ')} `);
  }

  private renderInputPrompt() {
    const promptText = chalk.bold.hex('#00FFCC')(`> [#${this.selectedChannel}] `) + this.inputBuffer + chalk.inverse(' ');
    process.stdout.write(`\n\x1b[K${promptText}`);
  }

  // --- Views ---

  private renderChatView(width: number): string {
    const output: string[] = [];
    const channelHeader = chalk.bold.hex('#818CF8')(`#${this.selectedChannel}`) + chalk.dim(` (Press 'c' to cycle channels: #general, #architecture, #api-contracts, #frontend, #backend, #blockers)`);
    output.push(` ${channelHeader}\n`);

    const filtered = this.messages.filter((m) => m.channel.toLowerCase() === this.selectedChannel.toLowerCase());
    const visible = filtered.slice(-14);

    if (visible.length === 0) {
      output.push(chalk.dim(`   (No messages yet in #${this.selectedChannel}. Press 'i' to post the first update!)`));
    } else {
      for (const msg of visible) {
        const time = new Date(msg.created_at).toLocaleTimeString();
        const isSelf = msg.from_agent_name === this.client.agentName;
        const agentBadge = msg.is_human
          ? chalk.bgHex('#3B82F6').black.bold(` 👤 ${msg.from_agent_name} `)
          : chalk.bgHex('#10B981').black.bold(` 🤖 ${msg.from_agent_name} `);

        const authorTag = chalk.dim(`(${msg.from_author})`);
        const timeTag = chalk.gray(`[${time}]`);

        output.push(` ${timeTag} ${agentBadge} ${authorTag}:`);

        // Format message lines
        const msgLines = msg.content.split('\n');
        for (const line of msgLines) {
          // Highlight code backticks or mentions
          let formattedLine = line.replace(/`([^`]+)`/g, chalk.hex('#F59E0B')('$1'));
          formattedLine = formattedLine.replace(/@([a-zA-Z0-9_-]+)/g, chalk.hex('#EC4899').bold('@$1'));
          output.push(`    ${formattedLine}`);
        }
        output.push('');
      }
    }

    return output.join('\n');
  }

  private renderTaskBoard(width: number): string {
    const table = new Table({
      head: [chalk.cyan('ID'), chalk.cyan('Status'), chalk.cyan('Pri'), chalk.cyan('Title'), chalk.cyan('Assignee'), chalk.cyan('Created By')],
      colWidths: [10, 14, 10, Math.max(30, width - 65), 18, 16],
      style: { head: [], border: ['gray'] },
    });

    const statusBadge = (s: string) => {
      switch (s) {
        case 'open':
          return chalk.bgBlue.black(' OPEN ');
        case 'in_progress':
          return chalk.bgYellow.black(' IN PROG ');
        case 'review':
          return chalk.bgMagenta.black(' REVIEW ');
        case 'completed':
          return chalk.bgGreen.black(' DONE ');
        case 'blocked':
          return chalk.bgRed.black(' BLOCKED ');
        default:
          return s;
      }
    };

    const priBadge = (p: string) => {
      switch (p) {
        case 'urgent':
          return chalk.red.bold('URGENT');
        case 'high':
          return chalk.red('HIGH');
        case 'medium':
          return chalk.yellow('MED');
        case 'low':
          return chalk.gray('LOW');
        default:
          return p;
      }
    };

    if (this.tasks.length === 0) {
      table.push(['-', '-', '-', 'No tasks yet. Press \'i\' and type: /task <title>', '-', '-']);
    } else {
      for (const t of this.tasks) {
        table.push([
          chalk.dim(t.id),
          statusBadge(t.status),
          priBadge(t.priority),
          t.status === 'completed' ? chalk.strikethrough(t.title) : chalk.white(t.title),
          t.assigned_to_agent ? chalk.green(t.assigned_to_agent) : chalk.dim('unassigned'),
          chalk.dim(`${t.created_by_author}`),
        ]);
      }
    }

    return `\n${table.toString()}\n`;
  }

  private renderAgentFleet(width: number): string {
    const table = new Table({
      head: [chalk.cyan('Agent Name'), chalk.cyan('Status'), chalk.cyan('Colleague / Author'), chalk.cyan('Model'), chalk.cyan('Current Task'), chalk.cyan('Last Seen')],
      colWidths: [20, 12, 20, 16, Math.max(25, width - 85), 12],
      style: { head: [], border: ['gray'] },
    });

    for (const a of this.agents) {
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

    return `\n${table.toString()}\n`;
  }

  private renderResourceLocks(width: number): string {
    const table = new Table({
      head: [chalk.cyan('Resource Path / File'), chalk.cyan('Locked By Agent'), chalk.cyan('Author'), chalk.cyan('Reason'), chalk.cyan('Expires In')],
      colWidths: [Math.max(30, width - 65), 18, 16, 22, 14],
      style: { head: [], border: ['gray'] },
    });

    if (this.locks.length === 0) {
      table.push(['No files currently locked.', '-', '-', 'Concurrency safe! ✨', '-']);
    } else {
      for (const l of this.locks) {
        const timeLeftSec = Math.max(0, Math.floor((l.expires_at - Date.now()) / 1000));
        const expiresStr = `${Math.floor(timeLeftSec / 60)}m ${timeLeftSec % 60}s`;

        table.push([
          chalk.bold.hex('#F59E0B')(`🔒 ${l.resource_path}`),
          chalk.green(l.locked_by_agent),
          chalk.white(l.locked_by_author),
          chalk.dim(l.reason),
          chalk.red(expiresStr),
        ]);
      }
    }

    return `\n${table.toString()}\n`;
  }

  private renderSharedContext(width: number): string {
    const table = new Table({
      head: [chalk.cyan('Key (Blackboard)'), chalk.cyan('Value / Spec'), chalk.cyan('Updated By'), chalk.cyan('Updated At')],
      colWidths: [22, Math.max(35, width - 65), 18, 14],
      style: { head: [], border: ['gray'] },
    });

    if (this.contexts.length === 0) {
      table.push(['No shared context keys set.', 'Set keys using: mesh context set <key> <val>', '-', '-']);
    } else {
      for (const c of this.contexts) {
        const preview = c.value.replace(/\n/g, ' ').slice(0, 50);
        const time = new Date(c.updated_at).toLocaleTimeString();
        table.push([
          chalk.bold.hex('#38BDF8')(c.key),
          chalk.white(preview),
          chalk.dim(`${c.updated_by_agent} (${c.updated_by_author})`),
          chalk.dim(time),
        ]);
      }
    }

    return `\n${table.toString()}\n`;
  }

  private renderArtifacts(width: number): string {
    const table = new Table({
      head: [chalk.cyan('Artifact Name'), chalk.cyan('Type'), chalk.cyan('Description'), chalk.cyan('Author'), chalk.cyan('Ver'), chalk.cyan('Size')],
      colWidths: [22, 12, Math.max(30, width - 68), 16, 8, 10],
      style: { head: [], border: ['gray'] },
    });

    if (this.artifacts.length === 0) {
      table.push(['No artifacts shared yet.', '-', 'Share code/schemas with mesh artifact push', '-', '-', '-']);
    } else {
      for (const a of this.artifacts) {
        table.push([
          chalk.bold.hex('#A855F7')(a.name),
          chalk.dim(a.file_type),
          chalk.white(a.description || '-'),
          chalk.dim(a.created_by_author),
          chalk.yellow(`v${a.version}`),
          chalk.dim(`${Buffer.byteLength(a.content, 'utf8')} B`),
        ]);
      }
    }

    return `\n${table.toString()}\n`;
  }
}
