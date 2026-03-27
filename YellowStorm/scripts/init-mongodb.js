// ============================================================
// MongoDB Initialization Script for YellowStorm
// ============================================================
// Run with: mongosh "mongodb://localhost:27017/yellostorm" scripts/init-mongodb.js
// Or: ./scripts/init-db.sh
//
// This script initializes the database with all required
// collections, indexes, and seed data for a fresh install.
// ============================================================

print("🚀 Initializing YellowStorm MongoDB...");
print("   Database: yellostorm");

// Drop existing database (for clean reinstall)
// WARNING: This will delete ALL data!
// Comment out the next line to preserve existing data
// db.dropDatabase();

// ============================================================
// COLLECTIONS SETUP
// ============================================================

const collections = [
  'users', 'sessions', 'conversations', 'messages', 'agents',
  'models', 'tools', 'plans', 'roles', 'workspaces',
  'workspace_documents', 'workspace_settings', 'reports',
  'playbooks', 'playbook_design_messages', 'playbook_executions',
  'notifications', 'upload_sessions', 'shared_conversations',
  'usage', 'usage_logs', 'audit_logs', 'health_history',
  'logs', 'agent_types', 'agent_type_prompts', 'system_settings'
];

// Create collections (only if they don't exist)
collections.forEach(name => {
  if (!db.getCollectionNames().includes(name)) {
    db.createCollection(name);
    print(`  ✓ Created collection: ${name}`);
  } else {
    print(`  → Collection exists: ${name}`);
  }
});

// ============================================================
// INDEXES
// ============================================================

print("\n📊 Creating indexes...");

// Users
db.users.createIndex({ "email": 1 }, { unique: true });
db.users.createIndex({ "createdAt": 1 });
db.users.createIndex({ "isActive": 1 });

// Sessions
db.sessions.createIndex({ "token": 1 }, { unique: true, sparse: true });
db.sessions.createIndex({ "userId": 1 });
db.sessions.createIndex({ "expiresAt": 1 }, { expireAfterSeconds: 0 });

// Conversations
db.conversations.createIndex({ "userId": 1, "createdAt": -1 });
db.conversations.createIndex({ "userId": 1, "status": 1, "updatedAt": -1 });
db.conversations.createIndex({ "sessionId": 1 }, { sparse: true });

// Messages
db.messages.createIndex({ "conversationId": 1, "createdAt": 1 });
db.messages.createIndex({ "conversationId": 1, "role": 1, "createdAt": 1 });

// Agents
db.agents.createIndex({ "userId": 1, "isActive": 1 });
db.agents.createIndex({ "isPublic": 1, "isActive": 1 });

// Models
db.models.createIndex({ "modelId": 1 }, { unique: true });
db.models.createIndex({ "isActive": 1 });

// Tools
db.tools.createIndex({ "name": 1 }, { unique: true });
db.tools.createIndex({ "isActive": 1 });

// Plans
db.plans.createIndex({ "slug": 1 }, { unique: true });
db.plans.createIndex({ "isActive": 1, "displayOrder": 1 });

// Roles
db.roles.createIndex({ "name": 1 }, { unique: true });
db.roles.createIndex({ "priority": 1 });

// Workspaces
db.workspaces.createIndex({ "userId": 1 });
db.workspaces.createIndex({ "conversationId": 1 }, { sparse: true });

// Workspace Documents
db.workspace_documents.createIndex({ "workspaceId": 1 });
db.workspace_documents.createIndex({ "uploadSessionId": 1 }, { sparse: true });

// Playbooks
db.playbooks.createIndex({ "userId": 1, "createdAt": -1 });
db.playbooks.createIndex({ "isPublic": 1, "isActive": 1 });

// Usage
db.usage.createIndex({ "userId": 1, "date": -1 });
db.usage.createIndex({ "userId": 1, "date": 1 });

// Audit Logs
db.audit_logs.createIndex({ "userId": 1, "createdAt": -1 });
db.audit_logs.createIndex({ "action": 1, "createdAt": -1 });

// Health History
db.health_history.createIndex({ "createdAt": 1 });
db.health_history.createIndex({ "component": 1, "createdAt": -1 });

print("  ✓ Indexes created");

// ============================================================
// SEED DATA - ROLES
// ============================================================

print("\n👤 Seeding roles...");

const roles = [
  {
    name: 'user',
    description: 'Default user role with no admin permissions',
    permissions: [],
    isActive: true,
    isSystem: true,
    priority: 0,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: 'tester',
    description: 'Tester with read-only analytics access',
    permissions: ['analytics.read'],
    isActive: true,
    isSystem: true,
    priority: 10,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: 'dev',
    description: 'Developer with analytics and system maintenance access',
    permissions: ['analytics.read', 'system.maintenance'],
    isActive: true,
    isSystem: true,
    priority: 20,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: 'moderator',
    description: 'Moderator with report and conversation management',
    permissions: ['reports.*', 'conversations.admin_delete'],
    isActive: true,
    isSystem: true,
    priority: 50,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: 'admin',
    description: 'Administrator with broad access except super admin features',
    permissions: [
      'users.*', 'plans.*', 'reports.*', 'workspaces.*',
      'analytics.*', 'conversations.*', 'admin.roles.read', 'admin.audit.read'
    ],
    isActive: true,
    isSystem: true,
    priority: 90,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: 'super_admin',
    description: 'Super administrator with full system access',
    permissions: ['*'],
    isActive: true,
    isSystem: true,
    priority: 100,
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

// Upsert roles
roles.forEach(role => {
  db.roles.updateOne(
    { name: role.name },
    { $setOnInsert: role },
    { upsert: true }
  );
});
print(`  ✓ ${roles.length} roles seeded`);

// ============================================================
// SEED DATA - PLANS
// ============================================================

print("\n📦 Seeding plans...");

const plans = [
  {
    name: 'Free',
    slug: 'free',
    description: 'Free tier with limited usage',
    tokenLimit: 10000,
    windowHours: 24,
    requestsPerMinute: 10,
    maxTokensPerRequest: 2000,
    features: ['basic_chat'],
    priority: 0,
    priceMonthly: 0,
    priceYearly: 0,
    currency: 'USD',
    isActive: true,
    isDefault: true,
    displayOrder: 0,
    maxWorkspaces: 3,
    workspaceStorageBytes: 104857600,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: 'Basic',
    slug: 'basic',
    description: 'Basic tier for individual users',
    tokenLimit: 100000,
    windowHours: 24,
    requestsPerMinute: 30,
    maxTokensPerRequest: 4000,
    features: ['basic_chat', 'history', 'export'],
    priority: 1,
    priceMonthly: 9.99,
    priceYearly: 99.99,
    currency: 'USD',
    isActive: true,
    isDefault: false,
    displayOrder: 1,
    maxWorkspaces: 10,
    workspaceStorageBytes: 2147483648,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: 'Enterprise',
    slug: 'enterprise',
    description: 'Enterprise tier for teams and businesses',
    tokenLimit: 1000000,
    windowHours: 24,
    requestsPerMinute: 60,
    maxTokensPerRequest: 8000,
    features: ['basic_chat', 'history', 'export', 'api_access', 'priority_support', 'analytics'],
    priority: 2,
    priceMonthly: 49.99,
    priceYearly: 499.99,
    currency: 'USD',
    isActive: true,
    isDefault: false,
    displayOrder: 2,
    maxWorkspaces: 50,
    workspaceStorageBytes: 10737418240,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: 'Unlimited',
    slug: 'unlimited',
    description: 'Unlimited usage for power users',
    tokenLimit: -1,
    windowHours: 24,
    requestsPerMinute: -1,
    maxTokensPerRequest: -1,
    features: ['basic_chat', 'history', 'export', 'api_access', 'priority_support', 'analytics', 'unlimited'],
    priority: 3,
    priceMonthly: 199.99,
    priceYearly: 1999.99,
    currency: 'USD',
    isActive: true,
    isDefault: false,
    displayOrder: 3,
    maxWorkspaces: -1,
    workspaceStorageBytes: 107374182400,
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

plans.forEach(plan => {
  db.plans.updateOne(
    { slug: plan.slug },
    { $setOnInsert: plan },
    { upsert: true }
  );
});
print(`  ✓ ${plans.length} plans seeded`);

// ============================================================
// SEED DATA - MODELS
// ============================================================

print("\n🤖 Seeding models...");

const models = [
  {
    modelId: 'gpt-4.1-mini',
    name: 'GPT 4.1 Mini',
    chef: 'Azure',
    chefSlug: 'azure',
    litellmModel: 'azure/gpt-4.1-mini',
    providers: ['azure'],
    isActive: true,
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    modelId: 'gpt-4.1',
    name: 'GPT 4.1',
    chef: 'Azure',
    chefSlug: 'azure',
    litellmModel: 'azure/gpt-4.1',
    providers: ['azure'],
    isActive: true,
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    modelId: 'gpt-4.1-nano',
    name: 'GPT 4.1 Nano',
    chef: 'Azure',
    chefSlug: 'azure',
    litellmModel: 'azure/gpt-4.1-nano',
    providers: ['azure'],
    isActive: true,
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    modelId: 'gpt-5.1-low',
    name: 'GPT 5.1 Low',
    chef: 'Azure',
    chefSlug: 'azure',
    litellmModel: 'azure/gpt-5.1-low',
    providers: ['azure'],
    isActive: true,
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    modelId: 'gpt-5.2-low',
    name: 'GPT 5.2 Low',
    chef: 'Azure',
    chefSlug: 'azure',
    litellmModel: 'azure/gpt-5.2-low',
    providers: ['azure'],
    isActive: true,
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    modelId: 'gpt-5.2-medium',
    name: 'GPT 5.2 Medium',
    chef: 'Azure',
    chefSlug: 'azure',
    litellmModel: 'azure/gpt-5.2-medium',
    providers: ['azure'],
    isActive: true,
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    modelId: 'gpt-5.2-high',
    name: 'GPT 5.2 High',
    chef: 'Azure',
    chefSlug: 'azure',
    litellmModel: 'azure/gpt-5.2-high',
    providers: ['azure'],
    isActive: true,
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    modelId: 'gpt-5-nano',
    name: 'GPT 5 Nano',
    chef: 'Azure',
    chefSlug: 'azure',
    litellmModel: 'azure/gpt-5-nano',
    providers: ['azure'],
    isActive: true,
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    modelId: 'claude-haiku-4-5',
    name: 'Claude Haiku 4 5',
    chef: 'Anthropic',
    chefSlug: 'anthropic',
    litellmModel: 'anthropic/claude-haiku-4-5',
    providers: ['anthropic'],
    isActive: true,
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    modelId: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4 5',
    chef: 'Anthropic',
    chefSlug: 'anthropic',
    litellmModel: 'anthropic/claude-sonnet-4-5',
    providers: ['anthropic'],
    isActive: true,
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    modelId: 'gemini-3',
    name: 'Gemini 3',
    chef: 'OpenRouter',
    chefSlug: 'openrouter',
    litellmModel: 'openrouter/gemini-3',
    providers: ['openrouter'],
    isActive: true,
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    modelId: 'glm-5',
    name: 'GLM 5',
    chef: 'OpenAI',
    chefSlug: 'openai',
    litellmModel: 'openai/glm-5',
    providers: ['openai'],
    isActive: true,
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

models.forEach(model => {
  db.models.updateOne(
    { modelId: model.modelId },
    { $setOnInsert: model },
    { upsert: true }
  );
});
print(`  ✓ ${models.length} models seeded`);

// ============================================================
// SEED DATA - AGENT TYPES
// ============================================================

print("\n🎭 Seeding agent types...");

const agentTypes = [
  {
    name: 'manager',
    slug: 'manager',
    defaultPrompt: `# CREATIVE MANAGER AGENT INSTRUCTIONS

You are a **CREATIVE manager agent**.

## CRITICAL WORKFLOW - YOU MUST FOLLOW THIS ORDER
1. **FIRST:** Create the execution plan using \`generate_execution_plan\` tool (all tasks start as \`"pending"\`).
2. **BEFORE delegating:**
   - Update the specific task status to \`"in_progress"\` in the plan.
   - **Only delegate if a delegation tool exists for the assigned agent.**
   - **If no delegation tool exists for a supposed agent, do not assume it exists or say it is available.**
3. **THEN:** Delegate the task to the assigned agent.
4. **AFTER task completes:** Update the plan to mark task as \`"completed"\` or \`"error"\`.

## MANDATORY RULES
- You **MUST** call \`generate_execution_plan\` **before** making your first delegation.
- You **MUST** update the plan to \`"in_progress"\` **before** each delegation.
- You **MUST** update the plan to \`"completed"\` or \`"error"\` **after** each task finishes.
- The plan must show which tasks are assigned to which agents.
- Include all steps from start to finish with clear descriptions.
- **NEVER** delegate without having a plan first.
- **NEVER** delegate a task if there is no delegation tool for the assigned agent.
- **NEVER** claim to have an agent that does not have a delegation tool. Always respond that the agent is unavailable if asked.

## TASK STATUS VALUES
- \`"pending"\`: Task not started yet (default for all new tasks).
- \`"in_progress"\`: Task currently being executed by an agent.
- \`"completed"\`: Task successfully finished.
- \`"error"\`: Task failed with an error.

## WORKFLOW EXAMPLE
1. User asks to \`"analyze sales and create report"\`.
2. You call \`generate_execution_plan\` with steps:
   \`\`\`json
   [
     {"task": "Analyze sales data", "agent": "Search agent", "status": "pending"},
     {"task": "Create report", "agent": "Report agent", "status": "pending"}
   ]
\`\`\``,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: 'Simple',
    slug: 'simple',
    defaultPrompt: '',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: 'Visualizer',
    slug: 'visualizer',
    defaultPrompt: 'You are a data visualization expert. Create clean, interactive HTML visualizations. Output ONLY the complete HTML code, with no explanations, markdown, or bash snippets. When creating visualizations: 1) Use a complete HTML structure with <!DOCTYPE html> 2) Include inline CSS for styling 3) Use Chart.js or vanilla JavaScript for interactivity 4) Make charts responsive and visually appealing 5) Use a clean, modern design with good color schemes 6) Add proper labels, titles, and legends 7) Ensure the visualization is self-contained (all CSS/JS inline).',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

agentTypes.forEach(type => {
  db.agent_types.updateOne(
    { slug: type.slug },
    { $setOnInsert: type },
    { upsert: true }
  );
});
print(`  ✓ ${agentTypes.length} agent types seeded`);

// ============================================================
// SEED DATA - TOOLS
// ============================================================

print("\n🔧 Seeding tools...");

const tools = [
  {
    name: 'search',
    description: "Search through the user's uploaded documents and knowledge base.\n- You are provided with a document tree structure that will guide you to select the most relevant documents\n- Searches internal documents, files, and personal knowledge base\n- When to use: When you need information from the user's documents or uploaded content\n- Use descriptive queries, avoid file names or specific references\n- Example: search(query=\"quarterly sales data\")",
    defaultAgentTypes: [],
    attributes: [
      {
        name: 'prompt',
        type: 'string',
        value: '<Document_Search_Tool_Instructions>\n# Document Search Tool Instructions\n\n## Priority\n- Always treat provided documents as the **primary** source of truth.\n- Use internal knowledge **only** if required info is not in the docs.\n\n## Mandatory tool use\n- **Must ALWAYS USE search tools for any info-retrieval task.**\n- EVEN if something related already exists in the <additional_context>\n- OR this task has been already executed before\n- If the task includes: *identify, find, locate, retrieve, extract, what is, who is, when did, how much, list all, summarize, compare*, or asks for specific **data/dates/names/figures/facts** → **immediately use search tools** (no assumptions).\n\n## Search Query generation rules\n- Generate at most 6 atomic queries, one for each distinct concept.\n- Must Always Rewrite each query in the **target document\'s language**.\n- If documents are filtered by an attribute, use the language of the **first** document in the set.\n- Must Use exact terminology from document domain\n- Must Include abbreviations AND full forms\n- Must Add contextual qualifiers (dates, names, categories) when available\n\n## Tool execution framework\n- **Never** use document search tools if **no documents** are available.\n- After each tool call, review results and choose the next action.\n\n### 1) Targeted search (Recherche ciblée)\n- Use only when specific documents are identified (name/attribute/document type).\n- Use always the given attribut / document type as filter if defined.\n- Run `perform_document_search` **once per query**.\n\n### 2) Global search (Recherche globale)\nUse only when no document is specified or targeted search is inefficient.\n- Run `perform_standard_search` **once per query**.\n\n## Source citations protocol when Search tools not enabled\n- Must Always generate source citations following the instructions as stated below:\n\n### Mandatory format\n- a source citation refers to a context used to generate a fact, details, attributes ...\n- it is always encapsuled inside brackets: **[1] [2] [3] ...**\n- Must always Use numeric sequence inside square brackets\n\n### Citation Requirements\nThe following rules must be applied for text and image sources.\n\n**Mandatory Citation Scope**\n- Must always generate source citations Even if there is already a mention about sources (image or text)\n- Must ALWAYS generate source citations when **generating tables, for every cell and row**.\n- Must always ensure to show all source citations considered as proof, not only the methodology citations.\n- you can find theses proofs in the current and historical context related to previous agent result\n- Must always include the most relevant source citations in **Every fact detail** generated in your response\n\n## Prohibited behaviors\n- Answering info requests without running search tools\n- Using prior knowledge instead of document search\n- Returning global results without targeted follow-up\n- Omitting citations\n- Fabricating or inferring beyond results\n</Document_Search_Tool_Instructions>',
        options: []
      },
      {
        name: 'top_k',
        type: 'number',
        value: 3,
        options: []
      }
    ],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: 'plan',
    description: 'Generate an execution plan showing task-agent assignments',
    defaultAgentTypes: ['manager'],
    attributes: [],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: 'Code Interpreter',
    description: 'Exécute du code Python dans des environnements sandbox isolés pour la manipulation avancée de données, le traitement de fichiers, et les tâches computationnelles.',
    defaultAgentTypes: [],
    attributes: [
      {
        name: 'prompt',
        type: 'string',
        value: '<Code_Interpretor_Tool_Usage>\n\nBefore using the code interpretor tool, must start by saying "🚀 Starting Code interpretor"\n\n# File Handling & Code Interpreter — Production Instructions\n\nYou must always show all the execution steps.\nYou must always generate a description (prefixed with 👉 ) about every tool call before and after the call\nYou must always place the tool call description in a new line\nDon\'t share your thoughts/reasoning with the user\n\n## Instruction for Excel(XLSX) operations\nWhen it comes to generate or update tables with numbers or calculations you must always consider implementing the suitables formulas to make the calculation dynamics.\nYou must always generate the final result in xlsx even if the user did not mention it.\n\n## Critical File Access Rules\n* **Always assume uploaded or referenced files exist** and proceed directly with processing.\n* **Never ask the user to confirm file names or locations** before attempting access.\n* **Only notify the user if a file does not exist after an access attempt fails** (e.g., `FileNotFoundError`).\n* **All files are automatically available in the working directory** before code execution.\n\n## Persistence Model\n\n### Variables\n* **Variables are NOT persistent between sessions.**\n* Any Python variables created in a session (e.g., `df`, `report`, `pdf_info`) are lost when the session ends.\n* Variables must be **reloaded or recreated** in each new session.\n\n### Files\n* **Files ARE persistent between sessions.**\n* Uploaded or generated files remain available in the working directory.\n* Previously uploaded or created files can be accessed in new sessions using the **same filenames**.\n\n## File Access in the Python Interpreter\n* All uploaded files are located in the **current working directory**.\n* **Use filenames directly** when loading files.\n\n### Correct Examples\n```python\nimport pandas as pd\ndf = pd.read_csv("rapport_ventes.csv")\ndf = pd.read_excel("rapport_ventes.xlsx")\n```\n\n### Incorrect Usage (Do NOT use)\n* Absolute or relative paths such as:\n  * `/mnt/downloaded_files/`\n  * `./uploads/`\n\nFiles are **automatically injected** into the environment before code execution.\n\n## Expected Workflow\n1. The user mentions or uploads a file.\n2. **Immediately begin processing**, assuming the file exists.\n3. Reference the file **directly by filename** in code.\n4. If a `FileNotFoundError` or similar exception occurs, **inform the user at that point**.\n\n## Appropriate Use of This Tool\nUse the Python / Code Interpreter tool for:\n* Executing Python code requested by the user\n* Analyzing data files (CSV, JSON, Excel, PDF, etc.)\n* Performing calculations or data transformations\n* Creating visualizations or charts\n* Generating reports or output files\n\n</Code_Interpretor_Tool_Usage>',
        options: []
      }
    ],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: 'search_web',
    description: 'This allows you to search the web',
    defaultAgentTypes: [],
    attributes: [
      {
        name: 'prompt',
        type: 'string',
        value: "For web sources:\n\n### Bonnes pratiques pour les liens :\n* Utiliser un titre descriptif et pertinent pour le lien.\n* Toujours placer la source immédiatement après l'information citée.\n* Ne jamais utiliser de HTML (`<a>`), uniquement le format Markdown.\n* Le texte du lien doit être clair et compréhensible",
        options: []
      }
    ],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

tools.forEach(tool => {
  db.tools.updateOne(
    { name: tool.name },
    { $setOnInsert: tool },
    { upsert: true }
  );
});
print(`  ✓ ${tools.length} tools seeded`);

// ============================================================
// VERIFICATION
// ============================================================

print("\n📊 Database Statistics:");
print(`  Collections: ${db.getCollectionNames().length}`);
print(`  Roles: ${db.roles.countDocuments()}`);
print(`  Plans: ${db.plans.countDocuments()}`);
print(`  Models: ${db.models.countDocuments()}`);
print(`  Agent Types: ${db.agent_types.countDocuments()}`);
print(`  Tools: ${db.tools.countDocuments()}`);

print("\n✅ MongoDB initialization complete!");
