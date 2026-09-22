/* eslint-disable no-console */
/**
 * Plan 1B.4.7 — merged tool seeds for catalog.tools / catalog.tool_categories.
 * Replaces the four Mongo seed scripts (2026-07-11 present-choices,
 * 2026-07-23 generate-web-preview, 2026-07-23 save-file-to-workspace,
 * 2026-08-21 run-code), which are deleted with this cutover.
 * Categories are upserted by name; tools use ON CONFLICT (name) DO NOTHING
 * (admin edits always win over re-seeding).
 *
 * Usage: npx ts-node back/scripts/seed/catalog-tools.ts
 */
import { config as loadEnv } from 'dotenv';
import { Pool } from 'pg';
import { newObjectId } from '../../src/common/postgres/object-id';

const CATEGORIES = [
  { name: 'Conversational UI', description: 'Native tools that render conversational UI components.' },
  { name: 'Workspace', description: 'Native tools that work with workspace content.' },
  { name: 'Execution', description: 'Native tools that execute bounded workloads.' },
];

const USAGE_PROMPT = `

<web_preview_tool>
Use generate_web_preview when an interactive or visual HTML presentation materially improves the answer. Give it a precise request containing the content, data, layout, and interactions to render. The tool displays its result automatically, so do not paste the generated HTML into conversational text. Continue with a concise normal response after the tool call.
</web_preview_tool>`;

const GENERATOR_INSTRUCTIONS = `Generate a complete, self-contained HTML document for the requested preview.

Return only HTML, without Markdown fences or explanatory text. Include all CSS and JavaScript inline. Do not use external scripts, stylesheets, fonts, images, network requests, forms, popups, or top-level navigation. Make the result responsive and accessible, and use the supplied conversation context and data exactly.`;

const PRESENT_CHOICES_DESCRIPTION = `Present a structured question, action, or suggestion with selectable answers.

Use this tool whenever the next response depends on the user selecting an intent, category, action, or confirmation. Do not use it for informational lists or when an open-ended response is sufficient.

Choose presentation deliberately:
- quick_replies: two to five short, mutually exclusive answers that can be submitted immediately. Use for simple routing, yes/no, or a next action with no explanation needed.
- list: use whenever an option needs a description, the user can choose multiple answers, an Other/custom answer is allowed, or the user must review and explicitly confirm before submitting. Multiple selection and custom answers always require explicit submission.

The component renders its own prompt, introduction, and options. When calling this tool, do not repeat the question, options, or a related introduction in conversational text. Do not emit bullets, numbered lists, dashes, or instructions to type an answer. Make the tool call without prose unless unrelated conversational context is essential.

Ground every option in the conversation. Give each option a stable id and concise visible label. Write submitText as an imperative, standalone action that tells the agent what to do and includes the option's intent and necessary context; never repeat only the visible label. An option may include an absolute HTTPS url when opening an external page is useful; it is rendered as a separate link and never replaces choice submission. Never use JavaScript, data URLs, HTTP URLs, or arbitrary executable actions.`;

const SAVE_FILE_DESCRIPTION = `Save an external file to a workspace from its download URL.

Use this tool after a connector or other external service returns a download URL and the file must become available in the workspace for later processing. Provide the target workspace ID, filename, and any download authorization headers supplied by the source.`;

const RUN_CODE_DESCRIPTION = `Run small, resource-bounded JavaScript workloads for JSON and text transformations, calculations, control flow, and authorized workspace files. QuickJS has no module loader or Node APIs: never use import, import(), require, or node:* modules. The injected async fs methods are list, glob, find, stat, readText, readJson, copy, writeText, writeJson, and remove. Start discovery with "const roots = await fs.list('/workspace');" and use returned virtual paths; never guess filenames or physical storage paths. Source workspaces and attachments are read-only, and /workspace/run is writable. glob and metadata-only find return safe logical file metadata. Use server-side copy for large/binary files instead of reading bytes through QuickJS. remove is limited to artifacts created or copied during the current execution. Code is an async function body: top-level await is allowed, and it must explicitly return a JSON-compatible value, for example with Object.fromEntries; a bare final expression is not returned.`;

const TOOLS = [
  {
    name: 'present_choices',
    category: 'Conversational UI',
    description: PRESENT_CHOICES_DESCRIPTION,
    icon: '',
    color: '',
    iconColor: 'light',
    defaultAgentTypes: [],
    attributes: [],
    requiredAppKey: null,
    isActive: true,
  },
  {
    name: 'generate_web_preview',
    category: 'Conversational UI',
    description: 'Generate and automatically render a self-contained interactive HTML preview when a visual response is useful.',
    icon: '',
    color: '',
    iconColor: 'light',
    defaultAgentTypes: [],
    attributes: [
      { name: 'prompt', type: 'string', value: USAGE_PROMPT },
      { name: 'instructions', type: 'string', value: GENERATOR_INSTRUCTIONS },
    ],
    requiredAppKey: null,
    isActive: true,
  },
  {
    name: 'save_file_to_workspace',
    category: 'Workspace',
    description: SAVE_FILE_DESCRIPTION,
    icon: '',
    color: '',
    iconColor: 'light',
    defaultAgentTypes: [],
    attributes: [],
    requiredAppKey: null,
    isActive: true,
  },
  {
    name: 'run_code',
    category: 'Execution',
    description: RUN_CODE_DESCRIPTION,
    icon: '',
    color: '',
    iconColor: 'light',
    defaultAgentTypes: [],
    attributes: [],
    requiredAppKey: null,
    isActive: true,
  },
];

async function main(): Promise<void> {
  loadEnv();
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  });

  for (const category of CATEGORIES) {
    await pool.query(
      `INSERT INTO catalog.tool_categories (id, name, description)
       VALUES ($1,$2,$3)
       ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description`,
      [newObjectId(), category.name, category.description],
    );
    console.log(`category ensured: ${category.name}`);
  }

  for (const tool of TOOLS) {
    const category = await pool.query<{ id: string }>('SELECT id FROM catalog.tool_categories WHERE name = $1', [tool.category]);
    const result = await pool.query(
      `INSERT INTO catalog.tools (id, name, description, icon, color, icon_color, category_id, default_agent_types,
        attributes, required_app_key, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
       ON CONFLICT (name) DO NOTHING`,
      [
        newObjectId(), tool.name, tool.description, tool.icon, tool.color, tool.iconColor,
        category.rows[0]?.id ?? null, tool.defaultAgentTypes,
        JSON.stringify(tool.attributes.map((attr, index) => ({ ...attr, id: `seedattr${String(index).padStart(16, '0')}` }))),
        tool.requiredAppKey, tool.isActive,
      ],
    );
    console.log(`${result.rowCount ? 'seeded' : 'kept existing'}: ${tool.name}`);
  }

  await pool.end();
}

main().catch((error) => { console.error(error); process.exit(1); });
