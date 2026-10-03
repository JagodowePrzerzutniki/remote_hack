import { MeshClient } from '../src/client/api-client';

const HUB_URL = process.argv[2] || 'http://localhost:8765';

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSimulation() {
  console.log('🚀 Starting Multi-Agent Hackathon Simulation on:', HUB_URL);

  // Agent 1: Lead Architect (Kacper / Gemini-3.7)
  const agentArchitect = new MeshClient({
    hubUrl: HUB_URL,
    agentName: 'Agent-Architect',
    authorName: 'Kacper',
    model: 'Gemini-3.7-Flash',
    capabilities: ['architecture', 'planning', 'db-design'],
  });

  // Agent 2: Backend Developer (Alex / Claude-3.7)
  const agentBackend = new MeshClient({
    hubUrl: HUB_URL,
    agentName: 'Agent-Backend',
    authorName: 'Alex',
    model: 'Claude-3.7-Sonnet',
    capabilities: ['nodejs', 'express', 'postgresql', 'auth'],
  });

  // Agent 3: Frontend Developer (Sarah / GPT-4o)
  const agentFrontend = new MeshClient({
    hubUrl: HUB_URL,
    agentName: 'Agent-Frontend',
    authorName: 'Sarah',
    model: 'GPT-4o',
    capabilities: ['react', 'tailwind', 'state-management'],
  });

  // 1. Register agents
  console.log('\n[1/6] Registering 3 autonomous agents...');
  await agentArchitect.registerAgent('busy', 'Defining System Architecture');
  await agentBackend.registerAgent('idle', 'Waiting for specs');
  await agentFrontend.registerAgent('idle', 'Waiting for specs');

  // 2. Architect posts kickoff message and system design
  console.log('\n[2/6] Architect posting system design to #architecture & blackboard...');
  await agentArchitect.sendMessage(
    'architecture',
    '👋 Team! I have finalized the core architecture for our hackathon project. We will use a Node.js + Express backend with a React + Tailwind frontend. I am saving the API contracts and DB models to the blackboard context.'
  );

  await agentArchitect.setContext(
    'api_contracts',
    JSON.stringify(
      {
        auth: {
          register: 'POST /api/auth/register { email, password } -> { token, user }',
          login: 'POST /api/auth/login { email, password } -> { token, user }',
          me: 'GET /api/auth/me [Bearer Token] -> { user }',
        },
        projects: {
          list: 'GET /api/projects -> Project[]',
          create: 'POST /api/projects { title, prompt } -> Project',
        },
      },
      null,
      2
    ),
    'REST API Contracts for Backend & Frontend alignment'
  );

  await agentArchitect.setContext(
    'env_config',
    'DATABASE_URL=postgres://...\nJWT_SECRET=supersecret\nPORT=3000\nCORS_ORIGIN=*',
    'Required environment variables for all agents'
  );

  // 3. Architect creates tasks on Kanban board
  console.log('\n[3/6] Architect creating initial backlog tasks...');
  const taskAuth = await agentArchitect.createTask(
    'Implement Auth & JWT Endpoints',
    'Follow the api_contracts spec. Support bcrypt password hashing and 24h JWT expiration.',
    'high'
  );

  const taskUI = await agentArchitect.createTask(
    'Build Authentication Screen & Project Dashboard',
    'Login modal, registration form, and project cards grid with Tailwind.',
    'high'
  );

  const taskDB = await agentArchitect.createTask(
    'Setup PostgreSQL Migrations & Prisma Client',
    'Create migrations for User, Project, and Session tables.',
    'medium'
  );

  // 4. Backend agent claims auth task and acquires file lock
  console.log('\n[4/6] Backend agent claims auth task & locks auth route files...');
  await agentBackend.claimTask(taskAuth.id);
  await agentBackend.sendMessage(
    'backend',
    `I have claimed task [${taskAuth.id}] "${taskAuth.title}". Locking \`src/routes/auth.ts\` while refactoring.`
  );

  const lockRes = await agentBackend.acquireLock('src/routes/auth.ts', 'Implementing JWT login and signup handlers', 15);
  console.log('   Lock acquired:', lockRes.success);

  // 5. Frontend agent claims UI task and checks context
  console.log('\n[5/6] Frontend agent claims UI task & reads API contracts...');
  await agentFrontend.claimTask(taskUI.id);
  const context = await agentFrontend.getContext('api_contracts');
  await agentFrontend.sendMessage(
    'frontend',
    `Claimed task [${taskUI.id}]. Retrieved API contracts from blackboard! @Agent-Backend let me know when auth endpoints are ready to test.`
  );

  // 6. Backend finishes task and shares artifact
  console.log('\n[6/6] Backend completes task, shares artifact & unlocks files...');
  await agentBackend.shareArtifact(
    'auth_routes.ts',
    `import { Router } from 'express';
export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  // Verified JWT Auth logic
  res.json({ token: 'mock-jwt-token-xyz', user: { id: '1', email: req.body.email } });
});`,
    'typescript',
    'Express auth routes implementation'
  );

  await agentBackend.updateTask(taskAuth.id, {
    status: 'completed',
    result_notes: 'Created /api/auth/login and /api/auth/register with full test coverage.',
  });

  await agentBackend.releaseLock('src/routes/auth.ts');
  await agentBackend.sendMessage(
    'backend',
    `🎉 Auth endpoints completed and unlocked! @Agent-Frontend you can now integrate the login form with \`/api/auth/login\`.`
  );

  console.log('\n✅ Simulation successfully finished! All agents collaborated in real-time.');
}

runSimulation().catch(console.error);
