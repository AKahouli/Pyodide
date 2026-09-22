import type { FunctionDeclaration } from '@google/genai';

export const CONCIERGE_SYSTEM_PROMPT = [
  'You are worky, a warm, concise spoken-voice concierge.',
  'You chat naturally and answer quick questions yourself.',
  // --- Never go silent around actions ---
  'Never call a tool silently. Before every tool call, first say a short spoken sentence: acknowledge the request and state what you are about to do (e.g. "Sure, let me start that for you" or "One moment, let me pull that task up").',
  'After a tool returns, always speak again to report the outcome (e.g. "Done — it is running now", or describe what you found). Never end your turn immediately after a tool result without saying something.',
  'If a tool returns an error, briefly explain that it did not work and what you will do next.',
  // --- Tools ---
  'You do NOT do tasks yourself — a separate worky agent, working alongside you, does all the real work. Your job is to hand work off to it. Whenever the user asks for ANYTHING to be done — research, a lookup, writing, sending an email, contacting someone, any action or deliverable — first acknowledge out loud, then call dispatch_task with a clear, self-contained instruction that captures exactly what they want, and once it succeeds tell them you have started. Never try to do the work or answer a work request from your own knowledge, and never say you cannot do it — dispatch it. You answer directly ONLY for small talk and questions about the run itself (status, what tasks exist, a task detail).',
  'Do NOT dispatch while the user is still talking or explaining. Let them finish laying out the full request, ask a brief clarifying question if anything is unclear, and only when the discussion has clearly wrapped up and you have every detail do you call dispatch_task — once, at the end, with the complete instruction. Never dispatch mid-sentence or on a half-formed request.',
  'When the request involves a PERSON — contacting, messaging, emailing, calling, delegating to, or sending anything to someone named or referred to by role — you MUST first call search_human_agents to verify that person exists and resolve exactly who they are, BEFORE you dispatch. Never dispatch a task that names a person to reach without confirming them first. If the lookup returns no match, or more than one plausible match, do NOT dispatch: briefly say so and ask the user to clarify who they mean (or for an email address). Only dispatch once the person is confirmed.',
  'Worky runs the work asynchronously; you will receive progress updates prefixed with "[worky update:" — verbalize them naturally and briefly.',
  'Use query_status when the user asks whether something is done or how the overall run is going.',
  'Use list_tasks when the user asks what tasks exist, what is on the board, or which one to talk about — it returns each task with an id, title, lane and state.',
  'Use get_task_details when the user asks about a specific task. It REQUIRES the task\'s id. If you do not already have the task list, call list_tasks first, match the user\'s words to a task title, and call get_task_details with THAT task\'s id. Task ids are opaque strings — you use them SILENTLY to make the call and never say them aloud, but you always need one: never call get_task_details without a real id taken from list_tasks. It returns the description, result, blocked reason, timing and any produced files, so you can describe the task richly in your own words.',
  'Use stop_session when the user asks to stop, cancel, halt or abort everything — the whole run and all its tasks. This is final: the current work cannot be resumed afterwards, so only call it when the user clearly wants to stop. Acknowledge out loud first, then call it, then confirm that everything has been stopped.',
  // --- Memory (retrieve_memory) ---
  'You have a long-term memory of each user that persists across calls — their facts, preferences, and past requests. Whenever the answer depends on who the user is or what they like, want, or told you before — or when they refer to something as "my usual", "like last time", "you know the one" — first call retrieve_memory with the request or topic as the query, then answer using what it returns. Do NOT invent memories: if it returns nothing, you simply do not know yet, so ask.',
  // --- Style ---
  'Keep spoken replies short and natural. Summarize task details conversationally; never read tool JSON, ids, or raw fields aloud. Match the user language (French or English).',
].join(' ');

/**
 * The concierge's tools are NOT hardcoded here any more: they are sourced from
 * these MCP connectors' actions (see gemini-token.service). Each connector
 * points at one MCP; its action list contributes tools, and the browser relay
 * routes each tool call to that connector's MCP (see toolEndpoints).
 *
 * Order matters only for display — the first is the primary (task) MCP; others
 * add more tools (e.g. human-agents lookup). A missing/empty connector is just
 * skipped, so the concierge still works with whichever are present.
 *
 * Gemini Live has no MCP auto-execution (unlike the sync generateContent path),
 * so the model still needs FunctionDeclarations in its session setup — we build
 * them from the connectors' stored action schemas instead of a hardcoded array.
 * Execution stays the client-side relay to the right MCP per tool.
 */
export const WORKY_CONCIERGE_CONNECTOR_SLUGS = ['worky-concierge', 'human-agents', 'voice-memory'];

/**
 * Thematic (smart-memory) retrieval tool. NOT sourced from the connector like the
 * others: smart-memory's MCP needs a secret key the browser can't hold, so this
 * tool is backend-proxied — the browser routes this specific call to our own
 * /worky/voice/thematic-memory/retrieve endpoint (see useRealtimeVoiceSession),
 * which forwards to smart-memory with the key. Added to the setup only when
 * thematic memory is enabled (connector + key present).
 */
export const THEMATIC_RETRIEVE_TOOL_NAME = 'retrieve_thematic_memory';
export const THEMATIC_RETRIEVE_TOOL = {
  name: THEMATIC_RETRIEVE_TOOL_NAME,
  description:
    "Search the user's long-term thematic memory (facts, preferences, past decisions, people, dates, amounts) " +
    'for anything relevant to the current request. Call this whenever the answer depends on who the user is or ' +
    'what they like, want, or told you before — including references like "my usual" or "like last time". ' +
    'Returns memory cards; if it returns nothing, you simply do not know yet, so ask.',
  parameters: {
    type: 'OBJECT',
    properties: { query: { type: 'STRING', description: 'What to look up, in natural language.' } },
    required: ['query'],
  },
} as unknown as FunctionDeclaration;

/**
 * A connector's mcpServerUrl is a canonical/server-side URL, but the browser
 * (which runs the tool relay) needs a reachable host. `0.0.0.0` is a bind
 * address, not connectable from a browser — map it to localhost.
 */
export function browserReachableMcpUrl(url: string): string {
  // Strip any whitespace (a stray space in a stored URL breaks the browser's
  // fetch) and map the 0.0.0.0 bind address to a connectable host.
  return (url || '').replace(/\s+/g, '').replace('0.0.0.0', 'localhost');
}

/**
 * Convert a JSON-Schema fragment (as stored on a connector action's
 * parameterSchema) into the Gemini raw-proto Schema shape: uppercase `type`,
 * recursed properties/items. JSON-schema unions like ["string","null"] collapse
 * to the first non-null type.
 */
function toGeminiSchema(schema: Record<string, any> | undefined): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return { type: 'OBJECT', properties: {} };
  const out: Record<string, unknown> = {};
  const t = schema.type;
  if (typeof t === 'string') out.type = t.toUpperCase();
  else if (Array.isArray(t)) {
    const first = t.find((x) => x !== 'null');
    if (first) out.type = String(first).toUpperCase();
  }
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.properties && typeof schema.properties === 'object') {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, toGeminiSchema(v as Record<string, any>)]),
    );
  }
  if (Array.isArray(schema.required)) out.required = schema.required;
  if (schema.items) out.items = toGeminiSchema(schema.items as Record<string, any>);
  return out;
}

/** Connector actions -> Gemini function declarations (the concierge's tools). */
export function connectorActionsToFunctionDeclarations(
  actions: Array<{ key: string; description?: string; parameterSchema?: Record<string, unknown> }>,
): FunctionDeclaration[] {
  return actions.map((a) => ({
    name: a.key,
    description: a.description ?? '',
    parameters: toGeminiSchema(a.parameterSchema as Record<string, any>),
  })) as unknown as FunctionDeclaration[];
}

/**
 * Builds the raw BidiGenerateContentSetup message sent as the first WS frame.
 * NOTE: the raw Live proto nests responseModalities/speechConfig under
 * `generationConfig` — unlike the SDK's flat LiveConnectConfig — so this shape
 * is intentional. `functionDeclarations` are sourced from the connector.
 */
/**
 * A line telling the concierge who it is speaking with — name and role — so it
 * greets and addresses them naturally and tailors its tone to their role.
 * Empty when we have no name to give.
 */
export function conciergeRequesterLine(
  requester?: { name?: string; email?: string; role?: string },
): string {
  if (!requester) return '';
  const name = (requester.name ?? '').trim();
  const role = (requester.role ?? '').trim();
  if (!name) return '';
  const who = role ? `${name}, whose role is ${role}` : name;
  return (
    `You are speaking with ${who}. Greet them by name and address them naturally, ` +
    `and take their role into account when deciding how much detail to give.`
  );
}

export function buildSetupMessage(
  model: string,
  voice: string,
  functionDeclarations: FunctionDeclaration[],
  opts: {
    resumptionHandle?: string;
    prompt?: string;
    requester?: { name?: string; email?: string; role?: string };
  } = {},
): Record<string, unknown> {
  const base = opts.prompt && opts.prompt.trim().length > 0 ? opts.prompt.trim() : CONCIERGE_SYSTEM_PROMPT;
  const who = conciergeRequesterLine(opts.requester);
  const systemText = who ? `${base}\n\n${who}` : base;
  return {
    model: `models/${model}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
    systemInstruction: { parts: [{ text: systemText }] },
    tools: [{ functionDeclarations }],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    sessionResumption: opts.resumptionHandle ? { handle: opts.resumptionHandle } : {},
    contextWindowCompression: { slidingWindow: {} },
  };
}
