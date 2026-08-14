# Worky Realtime Voice Concierge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace worky's half-duplex STT/TTS voice loop with a realtime Gemini Live speech-to-speech concierge that converses naturally, dispatches work to the existing async orchestrator via function calling, and narrates progress — with all secrets/config server-side (BFF).

**Architecture:** The browser opens a direct WebSocket to Gemini Live using a single-use ephemeral token minted by the backend with `liveConnectConstraints` that lock model, voice, system prompt, and tool schemas server-side. Gemini handles conversation, VAD, and barge-in natively. When the user wants work done, Gemini emits `toolCall`s that the browser relays to thin backend endpoints, which drive the existing gRPC orchestrator. The browser injects milestone updates (from the existing SSE stream) back into the live session as text turns so the concierge speaks them.

**Tech Stack:** NestJS + `@google/genai` (backend token minting, gRPC orchestrator client), React + Vitest (frontend), Gemini Live `BidiGenerateContentConstrained` WebSocket protocol, Web Audio `AudioWorklet` (PCM 16 kHz up / 24 kHz down).

## Global Constraints

- **Zero config/secrets on the frontend.** No model name, voice, prompt, API key, or env in the client bundle. The backend returns an opaque connection envelope (`{ wsUrl, setup, expiresAt }`); the frontend relays `setup` verbatim and never authors Gemini config. `envelope.setup` is server-authored so any Gemini config change is a backend-only edit.
- **Reuse existing patterns verbatim:** config via `registerAs('worky', …)` + `Joi` in `config.schema.ts`; backend services take `constructor(private readonly config: ConfigService)` and read `this.config.get<T>('worky.<key>')`; controllers rely on the **global** `JwtAuthGuard` (do NOT add a JWT guard) and add `@ApiBearerAuth()` + `@RequirePermissions(Permissions.WORKY_STREAM_WRITE)`; user id via `@CurrentUser() user: UserDocument` → `user._id.toString()`; outbound HTTP via native `fetch` + `AbortSignal.timeout(...)`.
- **Backend paths:** worky config is at `back/src/config/worky.config.ts` (NOT under `modules/worky/config/`). Orchestrator client is `back/src/modules/worky/services/worky-orchestrator.grpc-client.service.ts`.
- **Never log secrets.** Mirror `WorkyTtsService` `OnModuleInit` logging (`apiKey: this.apiKey ? 'set' : 'unset'`).
- **Preserve the frontend UI contract:** the `VoiceSessionApi` interface (`front/src/modules/worky/voice/useVoiceSession.ts:11-30`) must be honored unchanged by the new realtime hook so `VoiceSession.tsx`/`VoiceOrb` keep working.
- **Do not delete the OpenRouter STT/TTS path** — it stays as the runtime fallback.
- **Gemini Live model** (`WORKY_VOICE_MODEL`) default `gemini-3.1-flash-live-preview`; confirm the current live model id via ctx7 before starting Task 3 and update the default if Google has rev'd it.

---

### Task 1: Voice config, env validation, and dependency

**Files:**
- Modify: `back/package.json` (add `@google/genai` dependency)
- Modify: `back/src/config/worky.config.ts` (add `voice*` keys after the `tts*` block, ~line 35)
- Modify: `back/src/config/config.schema.ts` (add `WORKY_VOICE_*` after `WORKY_TTS_MAX_CHARS`, ~line 344)
- Test: `back/src/config/worky.config.spec.ts` (create)

**Interfaces:**
- Produces: `worky.voiceApiKey`, `worky.voiceModel`, `worky.voiceName`, `worky.voiceWsBaseUrl`, `worky.voiceTokenTtlSec`, `worky.voiceSessionStartTtlSec` config keys read via `ConfigService.get<T>('worky.<key>')`.

- [ ] **Step 1: Add the dependency**

Run: `cd back && npm install @google/genai`
Expected: `@google/genai` appears in `back/package.json` dependencies.

- [ ] **Step 2: Write the failing config test**

Create `back/src/config/worky.config.spec.ts`:

```ts
import workyConfig from './worky.config';

describe('workyConfig voice keys', () => {
  it('exposes voice defaults', () => {
    const c = workyConfig();
    expect(c.voiceModel).toBe('gemini-3.1-flash-live-preview');
    expect(c.voiceName).toBe('Kore');
    expect(c.voiceWsBaseUrl).toContain('BidiGenerateContentConstrained');
    expect(c.voiceTokenTtlSec).toBe(1800);
    expect(c.voiceSessionStartTtlSec).toBe(60);
    expect(c.voiceApiKey).toBe('');
  });

  it('reads voice overrides from env', () => {
    process.env.WORKY_VOICE_MODEL = 'gemini-x-live';
    expect(workyConfig().voiceModel).toBe('gemini-x-live');
    delete process.env.WORKY_VOICE_MODEL;
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `cd back && npx jest src/config/worky.config.spec.ts`
Expected: FAIL — `voiceModel` is `undefined`.

- [ ] **Step 4: Add the voice config keys**

In `back/src/config/worky.config.ts`, inside the `registerAs('worky', () => ({ … }))` object, immediately after the `tts*` entries add:

```ts
    // Realtime voice concierge (Gemini Live, direct browser WS via ephemeral token).
    voiceApiKey: process.env.WORKY_VOICE_API_KEY || '',
    voiceModel: process.env.WORKY_VOICE_MODEL || 'gemini-3.1-flash-live-preview',
    voiceName: process.env.WORKY_VOICE_NAME || 'Kore',
    voiceWsBaseUrl:
      process.env.WORKY_VOICE_WS_BASE_URL ||
      'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained',
    voiceTokenTtlSec: parseInt(process.env.WORKY_VOICE_TOKEN_TTL_SEC || '1800', 10),
    voiceSessionStartTtlSec: parseInt(process.env.WORKY_VOICE_SESSION_START_TTL_SEC || '60', 10),
```

- [ ] **Step 5: Add the Joi validation**

In `back/src/config/config.schema.ts`, after `WORKY_TTS_MAX_CHARS`:

```ts
  WORKY_VOICE_API_KEY: Joi.string().allow('').default(''),
  WORKY_VOICE_MODEL: Joi.string().default('gemini-3.1-flash-live-preview'),
  WORKY_VOICE_NAME: Joi.string().default('Kore'),
  WORKY_VOICE_WS_BASE_URL: Joi.string()
    .uri({ scheme: ['wss'] })
    .default(
      'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained',
    ),
  WORKY_VOICE_TOKEN_TTL_SEC: Joi.number().min(60).max(3600).default(1800),
  WORKY_VOICE_SESSION_START_TTL_SEC: Joi.number().min(30).max(600).default(60),
```

- [ ] **Step 6: Run the test to confirm it passes**

Run: `cd back && npx jest src/config/worky.config.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add back/package.json back/package-lock.json back/src/config/worky.config.ts back/src/config/config.schema.ts back/src/config/worky.config.spec.ts
git commit -m "feat(worky): add Gemini Live voice config + @google/genai dep"
```

---

### Task 2: Concierge config (system prompt, tool schemas, live constraints builder)

**Files:**
- Create: `back/src/modules/worky/voice/voice-concierge.config.ts`
- Test: `back/src/modules/worky/voice/voice-concierge.config.spec.ts`

**Interfaces:**
- Produces:
  - `CONCIERGE_SYSTEM_PROMPT: string`
  - `VOICE_TOOLS: FunctionDeclaration[]` — two tools named `dispatch_task` and `query_status`
  - `buildLiveConstraints(model: string, voice: string, opts?: { resumptionHandle?: string }): { model: string; config: Record<string, unknown> }`

- [ ] **Step 1: Write the failing test**

Create `back/src/modules/worky/voice/voice-concierge.config.spec.ts`:

```ts
import { CONCIERGE_SYSTEM_PROMPT, VOICE_TOOLS, buildLiveConstraints } from './voice-concierge.config';

describe('voice-concierge.config', () => {
  it('declares exactly the two v1 tools', () => {
    const names = VOICE_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(['dispatch_task', 'query_status']);
    const dispatch = VOICE_TOOLS.find((t) => t.name === 'dispatch_task')!;
    expect(Object.keys(dispatch.parameters!.properties!)).toContain('message');
    expect(dispatch.parameters!.required).toContain('message');
  });

  it('binds model, voice, transcription, resumption, compression and tools', () => {
    const c = buildLiveConstraints('gemini-live', 'Kore');
    expect(c.model).toBe('models/gemini-live');
    expect(c.config.responseModalities).toEqual(['AUDIO']);
    expect((c.config.speechConfig as any).voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore');
    expect(c.config.inputAudioTranscription).toBeDefined();
    expect(c.config.outputAudioTranscription).toBeDefined();
    expect(c.config.sessionResumption).toBeDefined();
    expect(c.config.contextWindowCompression).toBeDefined();
    expect((c.config.tools as any)[0].functionDeclarations).toHaveLength(2);
    expect((c.config.systemInstruction as any).parts[0].text).toContain('worky');
  });

  it('passes a resumption handle through when reconnecting', () => {
    const c = buildLiveConstraints('gemini-live', 'Kore', { resumptionHandle: 'h-123' });
    expect((c.config.sessionResumption as any).handle).toBe('h-123');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd back && npx jest src/modules/worky/voice/voice-concierge.config.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the config module**

Create `back/src/modules/worky/voice/voice-concierge.config.ts`:

```ts
import type { FunctionDeclaration } from '@google/genai';
import { Type } from '@google/genai';

export const CONCIERGE_SYSTEM_PROMPT = [
  'You are worky, a warm, concise spoken-voice concierge.',
  'You chat naturally and answer quick questions yourself.',
  'When the user actually wants work done, call the dispatch_task tool with a clear, self-contained instruction, then tell them you have started.',
  'Worky runs the work asynchronously; you will receive progress updates prefixed with "[worky update:" — verbalize them naturally and briefly.',
  'Use query_status only when the user asks whether something is done or what is happening.',
  'Keep spoken replies short. Never read tool JSON aloud. Match the user language (French or English).',
].join(' ');

export const VOICE_TOOLS: FunctionDeclaration[] = [
  {
    name: 'dispatch_task',
    description:
      'Start a worky task. Use when the user wants something done that requires research, tools, or multi-step work.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        message: {
          type: Type.STRING,
          description: 'The full, self-contained task instruction, phrased for worky.',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'query_status',
    description: 'Get the current status/plan of the ongoing worky task to tell the user how it is going.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
];

export function buildLiveConstraints(
  model: string,
  voice: string,
  opts: { resumptionHandle?: string } = {},
): { model: string; config: Record<string, unknown> } {
  return {
    model: `models/${model}`,
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      systemInstruction: { parts: [{ text: CONCIERGE_SYSTEM_PROMPT }] },
      tools: [{ functionDeclarations: VOICE_TOOLS }],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      sessionResumption: opts.resumptionHandle ? { handle: opts.resumptionHandle } : {},
      contextWindowCompression: { slidingWindow: {} },
    },
  };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd back && npx jest src/modules/worky/voice/voice-concierge.config.spec.ts`
Expected: PASS. (If `Type`/`FunctionDeclaration` import path differs in the installed `@google/genai`, adjust the import — verify with `node -e "console.log(Object.keys(require('@google/genai')))"`.)

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/worky/voice/voice-concierge.config.ts back/src/modules/worky/voice/voice-concierge.config.spec.ts
git commit -m "feat(worky): concierge system prompt, voice tools, live constraints builder"
```

---

### Task 3: GeminiTokenService (mint constrained ephemeral token)

**Files:**
- Create: `back/src/modules/worky/voice/gemini-token.service.ts`
- Test: `back/src/modules/worky/voice/gemini-token.service.spec.ts`

**Interfaces:**
- Consumes: `buildLiveConstraints` (Task 2); `worky.voice*` config (Task 1).
- Produces:
  - `interface VoiceSessionEnvelope { wsUrl: string; setup: Record<string, unknown>; expiresAt: string }`
  - `GeminiTokenService.mintSessionToken(opts?: { resumptionHandle?: string }): Promise<VoiceSessionEnvelope>`

- [ ] **Step 1: Write the failing test**

Create `back/src/modules/worky/voice/gemini-token.service.spec.ts`:

```ts
import { GeminiTokenService } from './gemini-token.service';

const createMock = jest.fn();
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    authTokens: { create: createMock },
  })),
  Type: { OBJECT: 'OBJECT', STRING: 'STRING' },
}));

function svc(overrides: Record<string, unknown> = {}) {
  const cfg = {
    'worky.voiceApiKey': 'test-key',
    'worky.voiceModel': 'gemini-live',
    'worky.voiceName': 'Kore',
    'worky.voiceWsBaseUrl': 'wss://host/ws/Constrained',
    'worky.voiceTokenTtlSec': 1800,
    'worky.voiceSessionStartTtlSec': 60,
    ...overrides,
  } as Record<string, unknown>;
  const config = { get: <T>(k: string) => cfg[k] as T } as any;
  return new GeminiTokenService(config);
}

describe('GeminiTokenService', () => {
  beforeEach(() => createMock.mockReset());

  it('mints a single-use constrained token and returns an opaque envelope', async () => {
    createMock.mockResolvedValue({ name: 'ephemeral-abc' });
    const env = await svc().mintSessionToken();

    const arg = createMock.mock.calls[0][0].config;
    expect(arg.uses).toBe(1);
    expect(arg.liveConnectConstraints.model).toBe('models/gemini-live');
    expect(arg.liveConnectConstraints.config.tools[0].functionDeclarations).toHaveLength(2);

    expect(env.wsUrl).toBe('wss://host/ws/Constrained?access_token=ephemeral-abc');
    expect(env.setup).toEqual({}); // config lives in the token; client relays an empty setup
    expect(typeof env.expiresAt).toBe('string');
  });

  it('threads a resumption handle into the bound config', async () => {
    createMock.mockResolvedValue({ name: 'ephemeral-xyz' });
    await svc().mintSessionToken({ resumptionHandle: 'h-9' });
    const arg = createMock.mock.calls[0][0].config;
    expect(arg.liveConnectConstraints.config.sessionResumption.handle).toBe('h-9');
  });

  it('throws a clear error when the API key is unset', async () => {
    await expect(svc({ 'worky.voiceApiKey': '' }).mintSessionToken()).rejects.toThrow(/not configured/i);
    expect(createMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd back && npx jest src/modules/worky/voice/gemini-token.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `back/src/modules/worky/voice/gemini-token.service.ts`:

```ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { buildLiveConstraints } from './voice-concierge.config';

export interface VoiceSessionEnvelope {
  wsUrl: string;
  setup: Record<string, unknown>;
  expiresAt: string;
}

@Injectable()
export class GeminiTokenService implements OnModuleInit {
  private readonly logger = new Logger(GeminiTokenService.name);
  private readonly apiKey = this.config.get<string>('worky.voiceApiKey') ?? '';
  private readonly model = this.config.get<string>('worky.voiceModel') ?? 'gemini-3.1-flash-live-preview';
  private readonly voice = this.config.get<string>('worky.voiceName') ?? 'Kore';
  private readonly wsBaseUrl = this.config.get<string>('worky.voiceWsBaseUrl') ?? '';
  private readonly tokenTtlSec = this.config.get<number>('worky.voiceTokenTtlSec') ?? 1800;
  private readonly startTtlSec = this.config.get<number>('worky.voiceSessionStartTtlSec') ?? 60;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.logger.log(`Gemini voice token service: model=${this.model} voice=${this.voice} apiKey=${this.apiKey ? 'set' : 'unset'}`);
  }

  async mintSessionToken(opts: { resumptionHandle?: string } = {}): Promise<VoiceSessionEnvelope> {
    if (!this.apiKey) throw new Error('Gemini voice is not configured (WORKY_VOICE_API_KEY missing)');

    const now = Date.now();
    const expireMs = now + this.tokenTtlSec * 1000;
    const client = new GoogleGenAI({ apiKey: this.apiKey, httpOptions: { apiVersion: 'v1alpha' } });

    let token: { name?: string };
    try {
      token = await client.authTokens.create({
        config: {
          uses: 1,
          expireTime: new Date(expireMs).toISOString(),
          newSessionExpireTime: new Date(now + this.startTtlSec * 1000).toISOString(),
          liveConnectConstraints: buildLiveConstraints(this.model, this.voice, opts),
          httpOptions: { apiVersion: 'v1alpha' },
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Gemini token mint failed: ${message}`);
    }

    if (!token?.name) throw new Error('Gemini token mint returned no token name');

    return {
      wsUrl: `${this.wsBaseUrl}?access_token=${token.name}`,
      setup: {}, // all config is bound in the token; client sends an empty setup and relays it verbatim
      expiresAt: new Date(expireMs).toISOString(),
    };
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd back && npx jest src/modules/worky/voice/gemini-token.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/worky/voice/gemini-token.service.ts back/src/modules/worky/voice/gemini-token.service.spec.ts
git commit -m "feat(worky): GeminiTokenService mints constrained ephemeral voice tokens"
```

> **Verification note (do at execution time, not a code placeholder):** confirm against current `@google/genai` docs (ctx7) whether the constrained endpoint requires the client `setup` to echo the model. If it does, change `setup: {}` to `setup: { model: 'models/' + this.model }` here (backend-only, frontend unaffected).

---

### Task 4: VoiceToolService (dispatch + status against the orchestrator)

**Files:**
- Create: `back/src/modules/worky/voice/voice-tool.service.ts`
- Test: `back/src/modules/worky/voice/voice-tool.service.spec.ts`

**Interfaces:**
- Consumes (existing services, exact signatures):
  - `WorkyStreamService.ensureKickoffContext(streamId: string, userId: string): Promise<{ aiSessionId: string }>`
  - `WorkyOrchestratorGrpcClientService.runTask(userId, sessionId, message, opts: { agents?; skills?; connectors? }): Promise<{ sessionId: string; accepted: boolean; runId: string }>`
  - `WorkyOrchestratorGrpcClientService.getSession(userId, sessionId): Promise<{ sessionId: string; title: string; status: string; plan: unknown }>`
  - `WorkyPlanningService.appendOwnerMessage(userId, streamId, dto: { content: string }): Promise<{ id: string; content: string; createdAt: string }>`
  - `WorkyTurnContextService.resolveWorkyAgents(userId): Promise<unknown[]>`, `.resolveConnectors(userId): Promise<unknown[]>`
- Produces:
  - `dispatchTask(userId: string, streamId: string, message: string): Promise<{ runId: string; sessionId: string; accepted: boolean }>`
  - `queryStatus(userId: string, streamId: string): Promise<{ status: string; title: string; plan: unknown }>`

- [ ] **Step 1: Write the failing test**

Create `back/src/modules/worky/voice/voice-tool.service.spec.ts`:

```ts
import { VoiceToolService } from './voice-tool.service';

describe('VoiceToolService', () => {
  const planning = { appendOwnerMessage: jest.fn() };
  const streamSvc = { ensureKickoffContext: jest.fn() };
  const orchestrator = { runTask: jest.fn(), getSession: jest.fn() };
  const turnContext = { resolveWorkyAgents: jest.fn(), resolveConnectors: jest.fn() };
  const svc = new VoiceToolService(planning as any, streamSvc as any, orchestrator as any, turnContext as any);

  beforeEach(() => jest.clearAllMocks());

  it('dispatch persists the utterance then runs the task with resolved context', async () => {
    planning.appendOwnerMessage.mockResolvedValue({ id: 'm1', content: 'do it', createdAt: 'now' });
    streamSvc.ensureKickoffContext.mockResolvedValue({ aiSessionId: 'sess-1' });
    turnContext.resolveWorkyAgents.mockResolvedValue([{ a: 1 }]);
    turnContext.resolveConnectors.mockResolvedValue([{ c: 1 }]);
    orchestrator.runTask.mockResolvedValue({ sessionId: 'sess-1', accepted: true, runId: 'run-9' });

    const res = await svc.dispatchTask('u1', 's1', 'do it');

    expect(planning.appendOwnerMessage).toHaveBeenCalledWith('u1', 's1', { content: 'do it' });
    expect(orchestrator.runTask).toHaveBeenCalledWith('u1', 'sess-1', 'do it', { agents: [{ a: 1 }], connectors: [{ c: 1 }] });
    expect(res).toEqual({ runId: 'run-9', sessionId: 'sess-1', accepted: true });
  });

  it('status reads the current session from the orchestrator', async () => {
    streamSvc.ensureKickoffContext.mockResolvedValue({ aiSessionId: 'sess-2' });
    orchestrator.getSession.mockResolvedValue({ sessionId: 'sess-2', title: 'T', status: 'running', plan: { steps: 3 } });

    const res = await svc.queryStatus('u1', 's2');

    expect(orchestrator.getSession).toHaveBeenCalledWith('u1', 'sess-2');
    expect(res).toEqual({ status: 'running', title: 'T', plan: { steps: 3 } });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd back && npx jest src/modules/worky/voice/voice-tool.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `back/src/modules/worky/voice/voice-tool.service.ts`. Import the real service classes from their existing locations (confirm relative paths at author time):

```ts
import { Injectable, Logger } from '@nestjs/common';
import { WorkyPlanningService } from '../services/worky-planning.service';
import { WorkyStreamService } from '../services/worky-stream.service';
import { WorkyOrchestratorGrpcClientService } from '../services/worky-orchestrator.grpc-client.service';
import { WorkyTurnContextService } from '../services/worky-turn-context.service';

@Injectable()
export class VoiceToolService {
  private readonly logger = new Logger(VoiceToolService.name);

  constructor(
    private readonly planning: WorkyPlanningService,
    private readonly streamService: WorkyStreamService,
    private readonly orchestrator: WorkyOrchestratorGrpcClientService,
    private readonly turnContext: WorkyTurnContextService,
  ) {}

  async dispatchTask(userId: string, streamId: string, message: string): Promise<{ runId: string; sessionId: string; accepted: boolean }> {
    await this.planning.appendOwnerMessage(userId, streamId, { content: message });
    const ctx = await this.streamService.ensureKickoffContext(streamId, userId);
    const [agents, connectors] = await Promise.all([
      this.turnContext.resolveWorkyAgents(userId),
      this.turnContext.resolveConnectors(userId),
    ]);
    const res = await this.orchestrator.runTask(userId, ctx.aiSessionId, message, { agents, connectors });
    this.logger.log(`[voice] dispatched task run=${res.runId} session=${res.sessionId}`);
    return { runId: res.runId, sessionId: res.sessionId, accepted: res.accepted };
  }

  async queryStatus(userId: string, streamId: string): Promise<{ status: string; title: string; plan: unknown }> {
    const ctx = await this.streamService.ensureKickoffContext(streamId, userId);
    const s = await this.orchestrator.getSession(userId, ctx.aiSessionId);
    return { status: s.status, title: s.title, plan: s.plan };
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd back && npx jest src/modules/worky/voice/voice-tool.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/worky/voice/voice-tool.service.ts back/src/modules/worky/voice/voice-tool.service.spec.ts
git commit -m "feat(worky): VoiceToolService bridges voice tools to the orchestrator"
```

---

### Task 5: DTOs + VoiceController + module wiring

**Files:**
- Create: `back/src/modules/worky/voice/dto/voice.dto.ts`
- Create: `back/src/modules/worky/voice/worky-voice.controller.ts`
- Modify: `back/src/modules/worky/worky.module.ts` (controllers array ~220-237, providers array ~238-275)
- Test: `back/src/modules/worky/voice/worky-voice.controller.spec.ts`

**Interfaces:**
- Consumes: `GeminiTokenService.mintSessionToken` (Task 3), `VoiceToolService.dispatchTask`/`queryStatus` (Task 4).
- Produces REST: `POST /worky/voice/session`, `POST /worky/voice/tool/dispatch`, `POST /worky/voice/tool/status`.

- [ ] **Step 1: Write the DTOs**

Create `back/src/modules/worky/voice/dto/voice.dto.ts`:

```ts
import { IsOptional, IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class CreateVoiceSessionDto {
  @IsOptional() @IsString() @MaxLength(512) resumptionHandle?: string;
}

export class VoiceDispatchDto {
  @IsString() @IsNotEmpty() @MaxLength(256) streamId!: string;
  @IsString() @IsNotEmpty() @MaxLength(50000) message!: string;
}

export class VoiceStatusDto {
  @IsString() @IsNotEmpty() @MaxLength(256) streamId!: string;
}
```

- [ ] **Step 2: Write the failing controller test**

Create `back/src/modules/worky/voice/worky-voice.controller.spec.ts`:

```ts
import { WorkyVoiceController } from './worky-voice.controller';

describe('WorkyVoiceController', () => {
  const tokens = { mintSessionToken: jest.fn() };
  const tools = { dispatchTask: jest.fn(), queryStatus: jest.fn() };
  const ctrl = new WorkyVoiceController(tokens as any, tools as any);
  const user = { _id: { toString: () => 'u1' } } as any;

  beforeEach(() => jest.clearAllMocks());

  it('POST session returns the minted envelope', async () => {
    tokens.mintSessionToken.mockResolvedValue({ wsUrl: 'wss://x?access_token=t', setup: {}, expiresAt: 'z' });
    const res = await ctrl.createSession(user, { resumptionHandle: 'h1' });
    expect(tokens.mintSessionToken).toHaveBeenCalledWith({ resumptionHandle: 'h1' });
    expect(res.wsUrl).toContain('access_token=t');
  });

  it('POST tool/dispatch forwards to VoiceToolService with the caller user id', async () => {
    tools.dispatchTask.mockResolvedValue({ runId: 'r', sessionId: 's', accepted: true });
    const res = await ctrl.dispatch(user, { streamId: 's1', message: 'go' });
    expect(tools.dispatchTask).toHaveBeenCalledWith('u1', 's1', 'go');
    expect(res.accepted).toBe(true);
  });

  it('POST tool/status forwards to VoiceToolService', async () => {
    tools.queryStatus.mockResolvedValue({ status: 'running', title: 'T', plan: {} });
    const res = await ctrl.status(user, { streamId: 's1' });
    expect(tools.queryStatus).toHaveBeenCalledWith('u1', 's1');
    expect(res.status).toBe('running');
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `cd back && npx jest src/modules/worky/voice/worky-voice.controller.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the controller**

Create `back/src/modules/worky/voice/worky-voice.controller.ts` (mirror the guard/decorator stack from `worky-tts.controller.ts`):

```ts
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { UserDocument } from '../../users/schemas/user.schema';
import { RequirePermissions } from '../../authorization/decorators/require-permissions.decorator';
import { Permissions } from '../../authorization/constants/permissions';
import { GeminiTokenService, VoiceSessionEnvelope } from './gemini-token.service';
import { VoiceToolService } from './voice-tool.service';
import { CreateVoiceSessionDto, VoiceDispatchDto, VoiceStatusDto } from './dto/voice.dto';

@ApiTags('Worky')
@ApiBearerAuth()
@Controller('worky/voice')
export class WorkyVoiceController {
  constructor(
    private readonly tokens: GeminiTokenService,
    private readonly tools: VoiceToolService,
  ) {}

  @Post('session')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  async createSession(@CurrentUser() _user: UserDocument, @Body() dto: CreateVoiceSessionDto): Promise<VoiceSessionEnvelope> {
    return this.tokens.mintSessionToken({ resumptionHandle: dto.resumptionHandle });
  }

  @Post('tool/dispatch')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  async dispatch(@CurrentUser() user: UserDocument, @Body() dto: VoiceDispatchDto) {
    return this.tools.dispatchTask(user._id.toString(), dto.streamId, dto.message);
  }

  @Post('tool/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  async status(@CurrentUser() user: UserDocument, @Body() dto: VoiceStatusDto) {
    return this.tools.queryStatus(user._id.toString(), dto.streamId);
  }
}
```

Confirm the import paths for `CurrentUser`, `UserDocument`, `RequirePermissions`, and `Permissions` against `worky-message.controller.ts` (they are the same imports it uses) and adjust the relative depth if needed.

- [ ] **Step 5: Wire the module**

In `back/src/modules/worky/worky.module.ts`: add `WorkyVoiceController` to the `controllers` array; add `GeminiTokenService`, `VoiceToolService` to the `providers` array. Add the imports at the top.

- [ ] **Step 6: Run the controller test + build**

Run: `cd back && npx jest src/modules/worky/voice/worky-voice.controller.spec.ts && npx tsc --noEmit -p tsconfig.json`
Expected: test PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add back/src/modules/worky/voice/dto back/src/modules/worky/voice/worky-voice.controller.ts back/src/modules/worky/voice/worky-voice.controller.spec.ts back/src/modules/worky/worky.module.ts
git commit -m "feat(worky): voice BFF controller (session/dispatch/status) + module wiring"
```

---

### Task 6: Transcript persistence (append voice turns to history)

**Files:**
- Modify: `back/src/modules/worky/schemas/worky-message.schema.ts` (add optional `origin?: 'voice'`)
- Modify: `back/src/modules/worky/services/worky-planning.service.ts` (add `appendVoiceMessage`)
- Modify: `back/src/modules/worky/voice/worky-voice.controller.ts` (add `POST tool/transcript`)
- Modify: `back/src/modules/worky/voice/dto/voice.dto.ts` (add `VoiceTranscriptDto`)
- Test: extend `back/src/modules/worky/services/worky-planning.service.spec.ts` (or create `worky-planning.voice.spec.ts`)

**Interfaces:**
- Produces: `WorkyPlanningService.appendVoiceMessage(userId: string, streamId: string, role: 'owner' | 'manager', content: string): Promise<{ id: string }>` and `POST /worky/voice/tool/transcript`.

- [ ] **Step 1: Add the schema field**

In `back/src/modules/worky/schemas/worky-message.schema.ts`, add to the message class/schema:

```ts
  @Prop({ type: String, required: false, enum: ['voice'] })
  origin?: 'voice';
```

- [ ] **Step 2: Write the failing test**

Create `back/src/modules/worky/services/worky-planning.voice.spec.ts`:

```ts
import { WorkyPlanningService } from './worky-planning.service';

describe('WorkyPlanningService.appendVoiceMessage', () => {
  it('creates a voice-origin message and emits message.appended', async () => {
    const created = { _id: { toString: () => 'm1' } };
    const messages = { create: jest.fn().mockResolvedValue(created) };
    const events = { emit: jest.fn() };
    // Instantiate with only the deps appendVoiceMessage touches; others can be undefined for this unit.
    const svc = Object.assign(Object.create(WorkyPlanningService.prototype), { messages, events });

    const res = await (svc as WorkyPlanningService).appendVoiceMessage('u1', 's1', 'manager', 'all done');

    expect(messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'manager', content: 'all done', origin: 'voice' }),
    );
    expect(events.emit).toHaveBeenCalledWith('u1', 's1', expect.objectContaining({ type: 'message.appended' }));
    expect(res).toEqual({ id: 'm1' });
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `cd back && npx jest src/modules/worky/services/worky-planning.voice.spec.ts`
Expected: FAIL — `appendVoiceMessage` not a function.

- [ ] **Step 4: Implement `appendVoiceMessage`**

In `back/src/modules/worky/services/worky-planning.service.ts`, add (mirrors the existing `create` + `events.emit` pattern, but no phase gate so it always persists; import `Types` if not present):

```ts
  async appendVoiceMessage(
    userId: string,
    streamId: string,
    role: 'owner' | 'manager',
    content: string,
  ): Promise<{ id: string }> {
    const message = await this.messages.create({
      streamId: new Types.ObjectId(streamId),
      role,
      content,
      planDeltaRef: null,
      origin: 'voice',
      emittedAt: new Date(),
    });
    const id = message._id.toString();
    this.events.emit(userId, streamId, {
      type: 'message.appended',
      emittedAt: Date.now(),
      payload: { id, role, content },
    });
    return { id };
  }
```

- [ ] **Step 5: Add DTO + endpoint**

In `voice.dto.ts`:

```ts
export class VoiceTranscriptDto {
  @IsString() @IsNotEmpty() @MaxLength(256) streamId!: string;
  @IsIn(['owner', 'manager']) role!: 'owner' | 'manager';
  @IsString() @IsNotEmpty() @MaxLength(50000) text!: string;
}
```
(add `IsIn` to the `class-validator` import). In `worky-voice.controller.ts` inject `WorkyPlanningService` and add:

```ts
  @Post('tool/transcript')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  async transcript(@CurrentUser() user: UserDocument, @Body() dto: VoiceTranscriptDto) {
    return this.planning.appendVoiceMessage(user._id.toString(), dto.streamId, dto.role, dto.text);
  }
```

- [ ] **Step 6: Run the test + typecheck**

Run: `cd back && npx jest src/modules/worky/services/worky-planning.voice.spec.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS + clean.

- [ ] **Step 7: Commit**

```bash
git add back/src/modules/worky/schemas/worky-message.schema.ts back/src/modules/worky/services/worky-planning.service.ts back/src/modules/worky/services/worky-planning.voice.spec.ts back/src/modules/worky/voice/dto/voice.dto.ts back/src/modules/worky/voice/worky-voice.controller.ts
git commit -m "feat(worky): persist voice transcripts to unified chat history"
```

---

### Task 7: Frontend voice API client

**Files:**
- Modify: `front/src/lib/api/config.ts` (add `voiceSession`, `voiceDispatch`, `voiceStatus`, `voiceTranscript` under `API_ENDPOINTS.worky`)
- Modify: `front/src/modules/worky/api.ts` (add the four functions)
- Test: `front/src/modules/worky/api.voice.test.ts`

**Interfaces:**
- Produces:
  - `interface VoiceSessionEnvelope { wsUrl: string; setup: Record<string, unknown>; expiresAt: string }`
  - `createVoiceSession(resumptionHandle?: string): Promise<VoiceSessionEnvelope>`
  - `voiceDispatch(streamId: string, message: string): Promise<{ runId: string; sessionId: string; accepted: boolean }>`
  - `voiceStatus(streamId: string): Promise<{ status: string; title: string; plan: unknown }>`
  - `voiceTranscript(streamId: string, role: 'owner' | 'manager', text: string): Promise<void>`

- [ ] **Step 1: Add endpoints**

In `front/src/lib/api/config.ts`, under `API_ENDPOINTS.worky`:

```ts
    voiceSession: '/worky/voice/session',
    voiceDispatch: '/worky/voice/tool/dispatch',
    voiceStatus: '/worky/voice/tool/status',
    voiceTranscript: '/worky/voice/tool/transcript',
```

- [ ] **Step 2: Write the failing test**

Create `front/src/modules/worky/api.voice.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createVoiceSession, voiceDispatch } from './api';
import apiClient from '@/lib/api/client';

vi.mock('@/lib/api/client', () => ({ default: { post: vi.fn() } }));

describe('voice api', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createVoiceSession posts the resumption handle and unwraps the envelope', async () => {
    (apiClient.post as any).mockResolvedValue({ data: { data: { wsUrl: 'wss://x', setup: {}, expiresAt: 'z' } } });
    const env = await createVoiceSession('h1');
    expect(apiClient.post).toHaveBeenCalledWith('/worky/voice/session', { resumptionHandle: 'h1' });
    expect(env.wsUrl).toBe('wss://x');
  });

  it('voiceDispatch posts streamId + message', async () => {
    (apiClient.post as any).mockResolvedValue({ data: { data: { runId: 'r', sessionId: 's', accepted: true } } });
    const res = await voiceDispatch('s1', 'go');
    expect(apiClient.post).toHaveBeenCalledWith('/worky/voice/tool/dispatch', { streamId: 's1', message: 'go' });
    expect(res.runId).toBe('r');
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `cd front && npx vitest run src/modules/worky/api.voice.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 4: Implement the functions**

In `front/src/modules/worky/api.ts` (reuse `apiClient`, `unwrap`, `ApiResponse`, `API_ENDPOINTS` already imported there):

```ts
export interface VoiceSessionEnvelope {
  wsUrl: string;
  setup: Record<string, unknown>;
  expiresAt: string;
}

export async function createVoiceSession(resumptionHandle?: string): Promise<VoiceSessionEnvelope> {
  const res = await apiClient.post<ApiResponse<VoiceSessionEnvelope>>(API_ENDPOINTS.worky.voiceSession, { resumptionHandle });
  return unwrap(res);
}

export async function voiceDispatch(streamId: string, message: string): Promise<{ runId: string; sessionId: string; accepted: boolean }> {
  const res = await apiClient.post<ApiResponse<{ runId: string; sessionId: string; accepted: boolean }>>(
    API_ENDPOINTS.worky.voiceDispatch,
    { streamId, message },
  );
  return unwrap(res);
}

export async function voiceStatus(streamId: string): Promise<{ status: string; title: string; plan: unknown }> {
  const res = await apiClient.post<ApiResponse<{ status: string; title: string; plan: unknown }>>(
    API_ENDPOINTS.worky.voiceStatus,
    { streamId },
  );
  return unwrap(res);
}

export async function voiceTranscript(streamId: string, role: 'owner' | 'manager', text: string): Promise<void> {
  await apiClient.post(API_ENDPOINTS.worky.voiceTranscript, { streamId, role, text });
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd front && npx vitest run src/modules/worky/api.voice.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add front/src/lib/api/config.ts front/src/modules/worky/api.ts front/src/modules/worky/api.voice.test.ts
git commit -m "feat(worky): frontend voice API client (session/dispatch/status/transcript)"
```

---

### Task 8: PCM audio helpers (pure, unit-tested)

**Files:**
- Create: `front/src/modules/worky/voice/pcmAudio.ts` (pure conversion helpers)
- Create: `front/src/modules/worky/voice/pcm-capture-worklet.ts` (worklet source string — integration-tested manually)
- Test: `front/src/modules/worky/voice/pcmAudio.test.ts`

**Interfaces:**
- Produces:
  - `floatTo16BitPCM(input: Float32Array): Int16Array`
  - `downsampleFloat(buffer: Float32Array, inRate: number, outRate: number): Float32Array`
  - `int16ToBase64(pcm: Int16Array): string`
  - `base64ToInt16(b64: string): Int16Array`
  - `PCM_CAPTURE_WORKLET: string` (worklet source, registers processor `pcm-capture`)

- [ ] **Step 1: Write the failing test**

Create `front/src/modules/worky/voice/pcmAudio.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { floatTo16BitPCM, downsampleFloat, int16ToBase64, base64ToInt16 } from './pcmAudio';

describe('pcmAudio', () => {
  it('clamps and scales float samples to int16', () => {
    const pcm = floatTo16BitPCM(new Float32Array([0, 1, -1, 2]));
    expect(pcm[0]).toBe(0);
    expect(pcm[1]).toBe(32767);
    expect(pcm[2]).toBe(-32768);
    expect(pcm[3]).toBe(32767); // clamped
  });

  it('downsamples 48k -> 16k by ~1/3 length', () => {
    const out = downsampleFloat(new Float32Array(48000).fill(0.5), 48000, 16000);
    expect(out.length).toBe(16000);
    expect(out[0]).toBeCloseTo(0.5, 5);
  });

  it('round-trips int16 <-> base64', () => {
    const src = new Int16Array([0, 123, -456, 32767, -32768]);
    expect(Array.from(base64ToInt16(int16ToBase64(src)))).toEqual(Array.from(src));
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd front && npx vitest run src/modules/worky/voice/pcmAudio.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

Create `front/src/modules/worky/voice/pcmAudio.ts`:

```ts
export function floatTo16BitPCM(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

export function downsampleFloat(buffer: Float32Array, inRate: number, outRate: number): Float32Array {
  if (outRate === inRate) return buffer;
  const ratio = inRate / outRate;
  const outLen = Math.round(buffer.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(buffer.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += buffer[j];
    out[i] = end > start ? sum / (end - start) : buffer[start] ?? 0;
  }
  return out;
}

export function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function base64ToInt16(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd front && npx vitest run src/modules/worky/voice/pcmAudio.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the capture worklet source**

Create `front/src/modules/worky/voice/pcm-capture-worklet.ts` (loaded via a Blob URL at runtime; emits raw Float32 frames to the main thread, which downsamples + encodes):

```ts
export const PCM_CAPTURE_WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
`;
```

- [ ] **Step 6: Commit**

```bash
git add front/src/modules/worky/voice/pcmAudio.ts front/src/modules/worky/voice/pcm-capture-worklet.ts front/src/modules/worky/voice/pcmAudio.test.ts
git commit -m "feat(worky): PCM conversion helpers + capture worklet for Gemini Live"
```

---

### Task 9: Gemini Live WebSocket client

**Files:**
- Create: `front/src/modules/worky/voice/geminiLiveClient.ts`
- Test: `front/src/modules/worky/voice/geminiLiveClient.test.ts`

**Interfaces:**
- Consumes: `VoiceSessionEnvelope` (Task 7), `int16ToBase64`/`base64ToInt16` (Task 8).
- Produces:
  - ```ts
    interface GeminiLiveHandlers {
      onAudio: (pcm: Int16Array) => void;
      onToolCall: (calls: Array<{ id: string; name: string; args: Record<string, unknown> }>) => void;
      onInputTranscript?: (text: string) => void;
      onOutputTranscript?: (text: string) => void;
      onResumptionHandle?: (handle: string) => void;
      onGoAway?: () => void;
      onClose?: (ev: CloseEvent) => void;
      onError?: (err: unknown) => void;
    }
    interface GeminiLiveConnection {
      sendAudioChunk: (pcm: Int16Array) => void;
      sendText: (text: string) => void;
      sendToolResponse: (responses: Array<{ id: string; name: string; response: Record<string, unknown> }>) => void;
      close: () => void;
    }
    function openGeminiLive(envelope: VoiceSessionEnvelope, handlers: GeminiLiveHandlers, wsFactory?: (url: string) => WebSocket): GeminiLiveConnection
    ```

- [ ] **Step 1: Write the failing test (with a fake WebSocket)**

Create `front/src/modules/worky/voice/geminiLiveClient.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { openGeminiLive } from './geminiLiveClient';
import { int16ToBase64 } from './pcmAudio';

class FakeWS {
  static OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onclose?: (e: any) => void;
  onerror?: (e: any) => void;
  constructor(public url: string) {}
  send(d: string) { this.sent.push(d); }
  close() { this.onclose?.({}); }
  emit(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}

function setup() {
  let ws!: FakeWS;
  const handlers = {
    onAudio: vi.fn(), onToolCall: vi.fn(), onResumptionHandle: vi.fn(), onOutputTranscript: vi.fn(),
  };
  const conn = openGeminiLive(
    { wsUrl: 'wss://x?access_token=t', setup: {}, expiresAt: 'z' },
    handlers as any,
    (url) => { ws = new FakeWS(url) as unknown as WebSocket as any; return ws as any; },
  );
  return { ws, conn, handlers };
}

describe('geminiLiveClient', () => {
  it('sends the setup message on open', () => {
    const { ws } = setup();
    ws.onopen?.();
    expect(JSON.parse(ws.sent[0])).toEqual({ setup: {} });
  });

  it('encodes audio chunks as realtimeInput pcm', () => {
    const { ws, conn } = setup();
    ws.onopen?.();
    conn.sendAudioChunk(new Int16Array([1, 2, 3]));
    const msg = JSON.parse(ws.sent[1]);
    expect(msg.realtimeInput.audio.mimeType).toBe('audio/pcm;rate=16000');
    expect(msg.realtimeInput.audio.data).toBe(int16ToBase64(new Int16Array([1, 2, 3])));
  });

  it('routes incoming toolCall and resumption + audio', () => {
    const { ws, handlers } = setup();
    ws.onopen?.();
    ws.emit({ toolCall: { functionCalls: [{ id: 'c1', name: 'dispatch_task', args: { message: 'go' } }] } });
    expect(handlers.onToolCall).toHaveBeenCalledWith([{ id: 'c1', name: 'dispatch_task', args: { message: 'go' } }]);
    ws.emit({ sessionResumptionUpdate: { resumable: true, newHandle: 'h-7' } });
    expect(handlers.onResumptionHandle).toHaveBeenCalledWith('h-7');
    ws.emit({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: int16ToBase64(new Int16Array([9])) } }] } } });
    expect(handlers.onAudio).toHaveBeenCalled();
  });

  it('sends tool responses', () => {
    const { ws, conn } = setup();
    ws.onopen?.();
    conn.sendToolResponse([{ id: 'c1', name: 'dispatch_task', response: { ok: true } }]);
    expect(JSON.parse(ws.sent[1])).toEqual({ toolResponse: { functionResponses: [{ id: 'c1', name: 'dispatch_task', response: { ok: true } }] } });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd front && npx vitest run src/modules/worky/voice/geminiLiveClient.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the client**

Create `front/src/modules/worky/voice/geminiLiveClient.ts`:

```ts
import type { VoiceSessionEnvelope } from '../api';
import { int16ToBase64, base64ToInt16 } from './pcmAudio';

export interface GeminiLiveHandlers {
  onAudio: (pcm: Int16Array) => void;
  onToolCall: (calls: Array<{ id: string; name: string; args: Record<string, unknown> }>) => void;
  onInputTranscript?: (text: string) => void;
  onOutputTranscript?: (text: string) => void;
  onResumptionHandle?: (handle: string) => void;
  onGoAway?: () => void;
  onClose?: (ev: CloseEvent) => void;
  onError?: (err: unknown) => void;
}

export interface GeminiLiveConnection {
  sendAudioChunk: (pcm: Int16Array) => void;
  sendText: (text: string) => void;
  sendToolResponse: (responses: Array<{ id: string; name: string; response: Record<string, unknown> }>) => void;
  close: () => void;
}

export function openGeminiLive(
  envelope: VoiceSessionEnvelope,
  handlers: GeminiLiveHandlers,
  wsFactory: (url: string) => WebSocket = (url) => new WebSocket(url),
): GeminiLiveConnection {
  const ws = wsFactory(envelope.wsUrl);
  const send = (obj: unknown) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); };

  ws.onopen = () => send({ setup: envelope.setup });
  ws.onerror = (e) => handlers.onError?.(e);
  ws.onclose = (e) => handlers.onClose?.(e as CloseEvent);
  ws.onmessage = (event) => {
    let msg: any;
    try { msg = JSON.parse(typeof event.data === 'string' ? event.data : ''); } catch { return; }

    if (msg.toolCall?.functionCalls) {
      handlers.onToolCall(msg.toolCall.functionCalls.map((f: any) => ({ id: f.id, name: f.name, args: f.args ?? {} })));
    }
    if (msg.sessionResumptionUpdate?.newHandle) handlers.onResumptionHandle?.(msg.sessionResumptionUpdate.newHandle);
    if (msg.goAway) handlers.onGoAway?.();

    const sc = msg.serverContent;
    if (sc) {
      if (sc.inputTranscription?.text) handlers.onInputTranscript?.(sc.inputTranscription.text);
      if (sc.outputTranscription?.text) handlers.onOutputTranscript?.(sc.outputTranscription.text);
      for (const part of sc.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) handlers.onAudio(base64ToInt16(part.inlineData.data));
      }
    }
  };

  return {
    sendAudioChunk: (pcm) => send({ realtimeInput: { audio: { data: int16ToBase64(pcm), mimeType: 'audio/pcm;rate=16000' } } }),
    sendText: (text) => send({ realtimeInput: { text } }),
    sendToolResponse: (responses) => send({ toolResponse: { functionResponses: responses } }),
    close: () => ws.close(),
  };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd front && npx vitest run src/modules/worky/voice/geminiLiveClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add front/src/modules/worky/voice/geminiLiveClient.ts front/src/modules/worky/voice/geminiLiveClient.test.ts
git commit -m "feat(worky): Gemini Live WebSocket client (audio/tool/transcript/resumption)"
```

---

### Task 10: Tool-call relay

**Files:**
- Create: `front/src/modules/worky/voice/toolCallRelay.ts`
- Test: `front/src/modules/worky/voice/toolCallRelay.test.ts`

**Interfaces:**
- Consumes: `voiceDispatch`, `voiceStatus` (Task 7); the tool-call shape from Task 9.
- Produces: `handleToolCall(streamId: string, call: { id: string; name: string; args: Record<string, unknown> }): Promise<{ id: string; name: string; response: Record<string, unknown> }>`

- [ ] **Step 1: Write the failing test**

Create `front/src/modules/worky/voice/toolCallRelay.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleToolCall } from './toolCallRelay';
import * as api from '../api';

vi.mock('../api');

describe('handleToolCall', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes dispatch_task to voiceDispatch', async () => {
    (api.voiceDispatch as any).mockResolvedValue({ runId: 'r', sessionId: 's', accepted: true });
    const res = await handleToolCall('s1', { id: 'c1', name: 'dispatch_task', args: { message: 'go' } });
    expect(api.voiceDispatch).toHaveBeenCalledWith('s1', 'go');
    expect(res).toEqual({ id: 'c1', name: 'dispatch_task', response: { runId: 'r', accepted: true } });
  });

  it('routes query_status to voiceStatus', async () => {
    (api.voiceStatus as any).mockResolvedValue({ status: 'running', title: 'T', plan: {} });
    const res = await handleToolCall('s1', { id: 'c2', name: 'query_status', args: {} });
    expect(res.response).toEqual({ status: 'running', title: 'T' });
  });

  it('returns an error response on failure so the model can recover', async () => {
    (api.voiceDispatch as any).mockRejectedValue(new Error('boom'));
    const res = await handleToolCall('s1', { id: 'c3', name: 'dispatch_task', args: { message: 'x' } });
    expect(res.response).toEqual({ error: 'boom' });
  });

  it('returns an error for unknown tools', async () => {
    const res = await handleToolCall('s1', { id: 'c4', name: 'nope', args: {} });
    expect(res.response).toHaveProperty('error');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd front && npx vitest run src/modules/worky/voice/toolCallRelay.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the relay**

Create `front/src/modules/worky/voice/toolCallRelay.ts`:

```ts
import { voiceDispatch, voiceStatus } from '../api';

export async function handleToolCall(
  streamId: string,
  call: { id: string; name: string; args: Record<string, unknown> },
): Promise<{ id: string; name: string; response: Record<string, unknown> }> {
  const wrap = (response: Record<string, unknown>) => ({ id: call.id, name: call.name, response });
  try {
    if (call.name === 'dispatch_task') {
      const r = await voiceDispatch(streamId, String(call.args.message ?? ''));
      return wrap({ runId: r.runId, accepted: r.accepted });
    }
    if (call.name === 'query_status') {
      const s = await voiceStatus(streamId);
      return wrap({ status: s.status, title: s.title });
    }
    return wrap({ error: `unknown tool: ${call.name}` });
  } catch (err) {
    return wrap({ error: err instanceof Error ? err.message : String(err) });
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd front && npx vitest run src/modules/worky/voice/toolCallRelay.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add front/src/modules/worky/voice/toolCallRelay.ts front/src/modules/worky/voice/toolCallRelay.test.ts
git commit -m "feat(worky): relay Gemini tool calls to worky BFF endpoints"
```

---

### Task 11: Milestone injector

**Files:**
- Create: `front/src/modules/worky/voice/milestoneInjector.ts`
- Test: `front/src/modules/worky/voice/milestoneInjector.test.ts`

**Interfaces:**
- Consumes: `subscribeToStreamEvents(streamId, onEvent, config?)` from `../stream/sse`; `WorkyEvent { type, data }` from `../types`.
- Produces:
  - `milestoneText(event: WorkyEvent): string | null` — maps milestone events to a short spoken-update string (prefixed `[worky update: …]`), returns `null` for non-milestones.
  - `attachMilestoneInjector(streamId: string, inject: (text: string) => void): () => void` — subscribes to the stream and calls `inject` for each milestone; returns an unsubscribe.

- [ ] **Step 1: Write the failing test**

Create `front/src/modules/worky/voice/milestoneInjector.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { milestoneText, attachMilestoneInjector } from './milestoneInjector';
import * as sse from '../stream/sse';

describe('milestoneText', () => {
  it('maps plan creation', () => {
    expect(milestoneText({ type: 'plan.version.created', data: {} })).toContain('[worky update:');
  });
  it('maps a manager final answer', () => {
    const t = milestoneText({ type: 'message.appended', data: { payload: { role: 'manager', content: 'Done: found 3.' } } } as any);
    expect(t).toContain('Done: found 3.');
  });
  it('ignores an owner message echo', () => {
    expect(milestoneText({ type: 'message.appended', data: { payload: { role: 'owner', content: 'hi' } } } as any)).toBeNull();
  });
  it('maps task completion', () => {
    expect(milestoneText({ type: 'task.completed', data: {} })).toContain('[worky update:');
  });
  it('ignores noisy token events', () => {
    expect(milestoneText({ type: 'assistant_token', data: {} } as any)).toBeNull();
  });
});

describe('attachMilestoneInjector', () => {
  it('injects only milestone events and returns an unsubscribe', () => {
    let handler!: (e: any) => void;
    const unsub = vi.fn();
    vi.spyOn(sse, 'subscribeToStreamEvents').mockImplementation((_id, onEvent) => { handler = onEvent as any; return unsub; });
    const inject = vi.fn();

    const off = attachMilestoneInjector('s1', inject);
    handler({ type: 'assistant_token', data: {} });
    handler({ type: 'task.completed', data: {} });
    expect(inject).toHaveBeenCalledTimes(1);
    off();
    expect(unsub).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd front && npx vitest run src/modules/worky/voice/milestoneInjector.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the injector**

Create `front/src/modules/worky/voice/milestoneInjector.ts`:

```ts
import { subscribeToStreamEvents } from '../stream/sse';
import type { WorkyEvent } from '../types';

export function milestoneText(event: WorkyEvent): string | null {
  switch (event.type) {
    case 'plan.version.created':
      return '[worky update: I have a plan and I am starting.]';
    case 'task.completed':
      return '[worky update: a step just finished.]';
    case 'report.generated':
      return '[worky update: the report is ready.]';
    case 'message.appended': {
      const payload = (event.data as { payload?: { role?: string; content?: string } }).payload;
      if (payload?.role === 'manager' && payload.content) return `[worky update: ${payload.content}]`;
      return null;
    }
    default:
      return null;
  }
}

export function attachMilestoneInjector(streamId: string, inject: (text: string) => void): () => void {
  return subscribeToStreamEvents(streamId, (event) => {
    const text = milestoneText(event);
    if (text) inject(text);
  });
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd front && npx vitest run src/modules/worky/voice/milestoneInjector.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add front/src/modules/worky/voice/milestoneInjector.ts front/src/modules/worky/voice/milestoneInjector.test.ts
git commit -m "feat(worky): inject worky milestones into the live voice session"
```

---

### Task 12: `useRealtimeVoiceSession` hook (integration) + reconnect helper

**Files:**
- Create: `front/src/modules/worky/voice/reconnectPolicy.ts` (pure, unit-tested)
- Create: `front/src/modules/worky/voice/useRealtimeVoiceSession.ts`
- Test: `front/src/modules/worky/voice/reconnectPolicy.test.ts`

**Interfaces:**
- Consumes: `createVoiceSession` (Task 7), `openGeminiLive` (Task 9), `handleToolCall` (Task 10), `attachMilestoneInjector` (Task 11), PCM helpers + worklet (Task 8), `useVoiceSettings` (existing), `voiceTranscript` (Task 7).
- Produces:
  - `shouldReconnect(closeCode: number, attempt: number, maxAttempts: number): boolean`
  - `useRealtimeVoiceSession(streamId: string): VoiceSessionApi` (the exact `VoiceSessionApi` shape from `useVoiceSession.ts:11-30`).

- [ ] **Step 1: Write the failing reconnect test**

Create `front/src/modules/worky/voice/reconnectPolicy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shouldReconnect } from './reconnectPolicy';

describe('shouldReconnect', () => {
  it('reconnects on abnormal close within budget', () => {
    expect(shouldReconnect(1006, 0, 5)).toBe(true);
  });
  it('reconnects after a goAway/normal close to continue the session', () => {
    expect(shouldReconnect(1000, 1, 5)).toBe(true);
  });
  it('stops after max attempts', () => {
    expect(shouldReconnect(1006, 5, 5)).toBe(false);
  });
  it('does not reconnect on auth failure (1008 policy violation)', () => {
    expect(shouldReconnect(1008, 0, 5)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd front && npx vitest run src/modules/worky/voice/reconnectPolicy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the reconnect policy**

Create `front/src/modules/worky/voice/reconnectPolicy.ts`:

```ts
// 1008 = policy violation (bad/expired token, permission) — do not retry.
export function shouldReconnect(closeCode: number, attempt: number, maxAttempts: number): boolean {
  if (closeCode === 1008) return false;
  return attempt < maxAttempts;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd front && npx vitest run src/modules/worky/voice/reconnectPolicy.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the hook**

Create `front/src/modules/worky/voice/useRealtimeVoiceSession.ts`. It returns the exact `VoiceSessionApi` shape so the UI is drop-in compatible. Wire: token fetch → WS → mic worklet (16 kHz up) → playback (24 kHz down) → tool relay → milestone injector → resumption reconnect → transcript persistence.

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceSessionApi, VoiceState } from './useVoiceSession';
import { useVoiceSettings } from './voiceSettings';
import { createVoiceSession, voiceTranscript } from '../api';
import { openGeminiLive, type GeminiLiveConnection } from './geminiLiveClient';
import { handleToolCall } from './toolCallRelay';
import { attachMilestoneInjector } from './milestoneInjector';
import { PCM_CAPTURE_WORKLET } from './pcm-capture-worklet';
import { downsampleFloat, floatTo16BitPCM } from './pcmAudio';
import { shouldReconnect } from './reconnectPolicy';

const MAX_RECONNECTS = 5;
const GEMINI_OUTPUT_RATE = 24000;

export function useRealtimeVoiceSession(streamId: string): VoiceSessionApi {
  const settings = useVoiceSettings();
  const [state, setState] = useState<VoiceState>('idle');
  const [level, setLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<{ you?: string; manager?: string }>({});

  const connRef = useRef<GeminiLiveConnection | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const handleRef = useRef<string | undefined>(undefined);
  const attemptRef = useRef(0);
  const mutedRef = useRef(false);
  const detachMilestonesRef = useRef<null | (() => void)>(null);
  const playHeadRef = useRef(0);

  const teardown = useCallback(() => {
    connRef.current?.close();
    connRef.current = null;
    detachMilestonesRef.current?.();
    detachMilestonesRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close();
    ctxRef.current = null;
  }, []);

  const playPcm = useCallback((pcm: Int16Array) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const f32 = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 0x8000;
    const buffer = ctx.createBuffer(1, f32.length, GEMINI_OUTPUT_RATE);
    buffer.copyToChannel(f32, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const now = ctx.currentTime;
    const at = Math.max(now, playHeadRef.current);
    src.start(at);
    playHeadRef.current = at + buffer.duration;
    setState('speaking');
    src.onended = () => { if (playHeadRef.current <= ctx.currentTime + 0.02) setState('listening'); };
  }, []);

  const connect = useCallback(async () => {
    const envelope = await createVoiceSession(handleRef.current);
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: settings.echoCancellation ?? true,
        noiseSuppression: settings.noiseSuppression ?? true,
        autoGainControl: settings.autoGainControl ?? true,
        ...(settings.deviceId ? { deviceId: { exact: settings.deviceId } } : {}),
      },
    });
    streamRef.current = stream;

    const blobUrl = URL.createObjectURL(new Blob([PCM_CAPTURE_WORKLET], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(blobUrl);
    URL.revokeObjectURL(blobUrl);
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'pcm-capture');
    source.connect(node);

    const conn = openGeminiLive(envelope, {
      onAudio: playPcm,
      onToolCall: async (calls) => {
        for (const call of calls) {
          const res = await handleToolCall(streamId, call);
          connRef.current?.sendToolResponse([res]);
        }
      },
      onInputTranscript: (t) => {
        setTranscript((p) => ({ ...p, you: t }));
        void voiceTranscript(streamId, 'owner', t).catch(() => undefined);
      },
      onOutputTranscript: (t) => {
        setTranscript((p) => ({ ...p, manager: t }));
        void voiceTranscript(streamId, 'manager', t).catch(() => undefined);
      },
      onResumptionHandle: (h) => { handleRef.current = h; },
      onGoAway: () => { /* server will close; onClose handles reconnect */ },
      onClose: (ev) => {
        if (shouldReconnect(ev.code, attemptRef.current, MAX_RECONNECTS)) {
          attemptRef.current += 1;
          void connect().catch((e) => setError(String(e)));
        } else if (ev.code === 1008) {
          setError('Voice session rejected. Please retry.');
          setState('idle');
        }
      },
      onError: (e) => setError(e instanceof Error ? e.message : String(e)),
    });
    connRef.current = conn;

    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (mutedRef.current) return;
      const f = e.data;
      let sum = 0;
      for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
      setLevel(Math.min(1, Math.sqrt(sum / f.length) * 4));
      conn.sendAudioChunk(floatTo16BitPCM(downsampleFloat(f, ctx.sampleRate, 16000)));
    };

    detachMilestonesRef.current = attachMilestoneInjector(streamId, (text) => conn.sendText(text));
    attemptRef.current = 0;
    setState('listening');
  }, [playPcm, settings, streamId]);

  const start = useCallback(() => {
    setError(null);
    handleRef.current = undefined;
    attemptRef.current = 0;
    connect().catch((e) => { setError(e instanceof Error ? e.message : String(e)); setState('idle'); });
  }, [connect]);

  const stop = useCallback(() => { teardown(); setState('idle'); setLevel(0); }, [teardown]);
  const toggleMute = useCallback(() => { mutedRef.current = !mutedRef.current; setMuted(mutedRef.current); }, []);

  useEffect(() => teardown, [teardown]);

  // Turn-mode methods are no-ops in realtime mode (Gemini VAD drives turns);
  // kept to satisfy the VoiceSessionApi contract used by the shared UI.
  const noop = useCallback(() => undefined, []);
  return { state, transcript, level, muted, error, start, stop, toggleMute, submitTurn: noop, cancelTurn: noop, beginTake: noop, interrupt: noop };
}
```

- [ ] **Step 6: Typecheck**

Run: `cd front && npx tsc --noEmit -p tsconfig.json`
Expected: clean. (If `VoiceState`/`VoiceSessionApi` are not exported from `useVoiceSession.ts`, export them there — a one-line `export` addition — and re-run.)

- [ ] **Step 7: Commit**

```bash
git add front/src/modules/worky/voice/reconnectPolicy.ts front/src/modules/worky/voice/reconnectPolicy.test.ts front/src/modules/worky/voice/useRealtimeVoiceSession.ts front/src/modules/worky/voice/useVoiceSession.ts
git commit -m "feat(worky): realtime voice session hook (Gemini Live, drop-in VoiceSessionApi)"
```

---

### Task 13: Feature flag + UI switch + fallback

**Files:**
- Modify: `front/src/modules/worky/voice/voiceSettings.ts` (add `realtimeVoice: boolean`, default `true`)
- Modify: `front/src/modules/worky/components/voice/VoiceSession.tsx` (choose hook by flag, fall back on error)
- Modify: `front/src/modules/worky/components/voice/VoiceSettingsSheet.tsx` (toggle for `realtimeVoice`)
- Test: `front/src/modules/worky/voice/voiceSettings.test.ts` (extend or create)

**Interfaces:**
- Consumes: `useRealtimeVoiceSession` (Task 12), existing `useVoiceSession`.
- Produces: `voiceSettings.realtimeVoice` flag; `VoiceSession` renders realtime when enabled, else legacy.

- [ ] **Step 1: Write the failing settings test**

Create/extend `front/src/modules/worky/voice/voiceSettings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { useVoiceSettings } from './voiceSettings';

describe('voiceSettings.realtimeVoice', () => {
  it('defaults realtimeVoice to true', () => {
    expect(useVoiceSettings.getState().realtimeVoice).toBe(true);
  });
  it('can toggle realtimeVoice', () => {
    useVoiceSettings.getState().set({ realtimeVoice: false });
    expect(useVoiceSettings.getState().realtimeVoice).toBe(false);
    useVoiceSettings.getState().set({ realtimeVoice: true });
  });
});
```
(Match the store's actual setter name — the report shows a zustand store; use its existing update method, e.g. `set`/`update`. Adjust the test to the real setter.)

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd front && npx vitest run src/modules/worky/voice/voiceSettings.test.ts`
Expected: FAIL — `realtimeVoice` undefined.

- [ ] **Step 3: Add the flag to the store**

In `front/src/modules/worky/voice/voiceSettings.ts`, add `realtimeVoice: true` to the persisted state shape/defaults (follow the existing field + persistence pattern in that file).

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd front && npx vitest run src/modules/worky/voice/voiceSettings.test.ts`
Expected: PASS.

- [ ] **Step 5: Switch the hook in the UI with fallback**

In `front/src/modules/worky/components/voice/VoiceSession.tsx`, select the session implementation by flag, and if the realtime session surfaces an error, fall back to the legacy pipeline:

```tsx
const { realtimeVoice } = useVoiceSettings();
const realtime = useRealtimeVoiceSession(realtimeVoice ? streamId : '');
const legacy = useVoiceSession(streamId);
const [fellBack, setFellBack] = useState(false);

useEffect(() => {
  if (realtimeVoice && realtime.error && !fellBack) setFellBack(true);
}, [realtimeVoice, realtime.error, fellBack]);

const session = realtimeVoice && !fellBack ? realtime : legacy;
```

Guard both hooks so the inactive one does nothing: `useRealtimeVoiceSession` should early-return the idle API when `streamId === ''` (add a guard at the top of `connect`/`start`), and ensure `useVoiceSession` does not auto-start. Render `session.*` exactly as before — the UI is unchanged because both satisfy `VoiceSessionApi`.

- [ ] **Step 6: Add the settings toggle**

In `VoiceSettingsSheet.tsx`, add a switch bound to `realtimeVoice` (mirror an existing boolean toggle like `echoCancellation`).

- [ ] **Step 7: Full frontend verification**

Run: `cd front && npx vitest run src/modules/worky/voice && npx tsc --noEmit -p tsconfig.json`
Expected: all voice tests PASS; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add front/src/modules/worky/voice/voiceSettings.ts front/src/modules/worky/voice/voiceSettings.test.ts front/src/modules/worky/components/voice/VoiceSession.tsx front/src/modules/worky/components/voice/VoiceSettingsSheet.tsx
git commit -m "feat(worky): realtime voice feature flag, UI switch, legacy fallback"
```

---

### Task 14: End-to-end manual verification + docs

**Files:**
- Modify: `back/.env.example` (add `WORKY_VOICE_*` vars) and any frontend env docs
- Create: `docs/superpowers/verification/2026-08-10-worky-voice-concierge-manual-check.md`

- [ ] **Step 1: Configure env**

Set `WORKY_VOICE_API_KEY` (a Gemini API key with Live API access) in the backend env; leave other `WORKY_VOICE_*` at defaults. Add all `WORKY_VOICE_*` (key value redacted) to `back/.env.example`.

- [ ] **Step 2: Run both apps**

Start backend + frontend. Open a worky stream, open the voice dock, ensure `realtimeVoice` is on.

- [ ] **Step 3: Manual test script (record results in the verification doc)**

Verify each: (a) small talk answered by the concierge with no worky task created; (b) "worky, research X" → hear "on it", an owner message appears in chat history, a plan/task starts; (c) milestone narration is spoken as the task progresses; (d) "is it done?" → status spoken; (e) barge-in: interrupt mid-sentence and the concierge stops; (f) let a conversation exceed the session cap → verify seamless resumption (no dropped context); (g) kill the network briefly → verify graceful fallback to the legacy STT/TTS pipeline; (h) confirm the browser bundle contains no Gemini API key/model/prompt (grep the built assets).

- [ ] **Step 4: Commit the verification record**

```bash
git add back/.env.example docs/superpowers/verification/2026-08-10-worky-voice-concierge-manual-check.md
git commit -m "docs(worky): voice concierge env example + manual verification record"
```

---

## Notes for the implementer

- **`@google/genai` surface may drift.** Before Task 2/3, run `node -e "console.log(Object.keys(require('@google/genai')))"` in `back/` and confirm `GoogleGenAI`, `authTokens.create`, `Type`, and `FunctionDeclaration` exist as used; adjust imports if the package reorganized.
- **Gemini Live message shapes** (`realtimeInput.audio`, `serverContent.modelTurn.parts[].inlineData`, `toolCall.functionCalls`, `sessionResumptionUpdate.newHandle`, `goAway`) are current as of this plan; re-confirm via ctx7 if a test's incoming-message assertion fails against a live session.
- **Input vs output sample rate:** capture/downsample to 16 kHz for input; Gemini outputs 24 kHz — playback uses a 24 kHz `AudioBuffer` (Task 12). Do not assume the `AudioContext` sample rate matches either.
- **Do not remove** the OpenRouter STT/TTS controllers/services or `useVoiceSession` — they are the fallback.
