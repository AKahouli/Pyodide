# Worky Inline Voice + Per-Stream Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the realtime voice concierge an inline, ambient dock on the desktop worky stream (no full-screen takeover), and let the concierge system prompt be configured and saved per worky stream.

**Architecture:** Extract the realtime-vs-legacy session selection + fallback into a shared `useWorkyVoiceSession(streamId, active)` hook consumed by both the desktop dock and the (retained) mobile sheet. The desktop dock runs voice in place with an animated mic. The concierge prompt is stored on the `WorkyStream` document, resolved server-side at token mint, and edited via a dialog opened from the dock.

**Tech Stack:** NestJS + Mongoose (backend), React + Vitest + Jest, existing shadcn `Dialog`/`Textarea`/`Button`, Gemini Live setup authored server-side.

## Global Constraints

- **Backend paths:** worky config `back/src/config/worky.config.ts`; voice module `back/src/modules/worky/voice/`; stream schema `back/src/modules/worky/schemas/worky-stream.schema.ts`.
- **Default prompt:** `CONCIERGE_SYSTEM_PROMPT` in `back/src/modules/worky/voice/voice-concierge.config.ts` remains the default when a stream has no `voicePrompt`.
- **Ownership:** reuse `WorkyPlanningService.loadStream(streamId, userId)` (private; throws `NotFoundException(ErrorCode.WORKY_STREAM_NOT_FOUND)` for invalid/missing/non-owner). New public methods live on `WorkyPlanningService`.
- **Controller conventions:** global `JwtAuthGuard`; add `@ApiBearerAuth()` + `@RequirePermissions(Permissions.WORKY_STREAM_WRITE)`; user via `@CurrentUser() user: UserDocument` → `user._id.toString()`.
- **Preserve the UI contract:** `VoiceSessionApi` (`front/src/modules/worky/voice/useVoiceSession.ts:11-30`) and `VoiceState = 'idle'|'listening'|'thinking'|'speaking'`.
- **Mobile keeps the sheet.** Do not delete `VoiceSession.tsx`; only desktop stops using it.
- **Backend Jest, frontend Vitest.** Follow existing `*.spec.ts` / `*.test.tsx` patterns.

---

### Task 1: `voicePrompt` on the stream + planning get/set

**Files:**
- Modify: `back/src/modules/worky/schemas/worky-stream.schema.ts` (add `voicePrompt` after `workerModelId`, ~line 69)
- Modify: `back/src/modules/worky/services/worky-planning.service.ts` (add two public methods after `appendVoiceMessage`)
- Test: `back/src/modules/worky/services/worky-planning.voice-prompt.spec.ts` (create)

**Interfaces:**
- Consumes: `loadStream(streamId, userId): Promise<WorkyStreamDocument>` (private, same class).
- Produces:
  - `WorkyPlanningService.getVoicePrompt(userId: string, streamId: string): Promise<{ prompt: string | null }>`
  - `WorkyPlanningService.setVoicePrompt(userId: string, streamId: string, prompt: string | null): Promise<{ prompt: string | null }>`

- [ ] **Step 1: Add the schema field**

In `worky-stream.schema.ts`, after the `workerModelId` `@Prop` (line 69):

```ts
  /** Per-stream concierge system prompt. null → use the global default. */
  @Prop({ type: String, default: null, trim: true, maxlength: 8000 })
  voicePrompt?: string | null;
```

- [ ] **Step 2: Write the failing test**

Create `back/src/modules/worky/services/worky-planning.voice-prompt.spec.ts`:

```ts
import { WorkyPlanningService } from './worky-planning.service';

function svcWithStream(stream: any) {
  const svc = Object.create(WorkyPlanningService.prototype) as WorkyPlanningService;
  // loadStream is private; stub it on the instance for the unit test.
  (svc as any).loadStream = jest.fn().mockResolvedValue(stream);
  return svc;
}

describe('WorkyPlanningService voice prompt', () => {
  it('getVoicePrompt returns the stored value', async () => {
    const svc = svcWithStream({ voicePrompt: 'be terse' });
    await expect(svc.getVoicePrompt('u1', 's1')).resolves.toEqual({ prompt: 'be terse' });
  });

  it('getVoicePrompt returns null when unset', async () => {
    const svc = svcWithStream({ voicePrompt: null });
    await expect(svc.getVoicePrompt('u1', 's1')).resolves.toEqual({ prompt: null });
  });

  it('setVoicePrompt trims and saves a non-empty prompt', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const stream: any = { voicePrompt: null, save };
    const svc = svcWithStream(stream);
    const res = await svc.setVoicePrompt('u1', 's1', '  hello  ');
    expect(stream.voicePrompt).toBe('hello');
    expect(save).toHaveBeenCalled();
    expect(res).toEqual({ prompt: 'hello' });
  });

  it('setVoicePrompt stores null for blank (reset to default)', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const stream: any = { voicePrompt: 'old', save };
    const svc = svcWithStream(stream);
    const res = await svc.setVoicePrompt('u1', 's1', '   ');
    expect(stream.voicePrompt).toBeNull();
    expect(res).toEqual({ prompt: null });
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `cd back && npx jest src/modules/worky/services/worky-planning.voice-prompt.spec.ts`
Expected: FAIL — `getVoicePrompt` is not a function.

- [ ] **Step 4: Implement the methods**

In `worky-planning.service.ts`, after `appendVoiceMessage`:

```ts
  async getVoicePrompt(userId: string, streamId: string): Promise<{ prompt: string | null }> {
    const stream = await this.loadStream(streamId, userId);
    return { prompt: stream.voicePrompt ?? null };
  }

  async setVoicePrompt(
    userId: string,
    streamId: string,
    prompt: string | null,
  ): Promise<{ prompt: string | null }> {
    const stream = await this.loadStream(streamId, userId);
    const trimmed = typeof prompt === 'string' ? prompt.trim() : '';
    stream.voicePrompt = trimmed.length > 0 ? trimmed : null;
    await stream.save();
    return { prompt: stream.voicePrompt };
  }
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd back && npx jest src/modules/worky/services/worky-planning.voice-prompt.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add back/src/modules/worky/schemas/worky-stream.schema.ts back/src/modules/worky/services/worky-planning.service.ts back/src/modules/worky/services/worky-planning.voice-prompt.spec.ts
git commit -m "feat(worky): store per-stream concierge prompt + planning get/set"
```

---

### Task 2: Thread the per-stream prompt into the Gemini setup

**Files:**
- Modify: `back/src/modules/worky/voice/voice-concierge.config.ts` (`buildSetupMessage` accepts a prompt)
- Modify: `back/src/modules/worky/voice/gemini-token.service.ts` (`mintSessionToken` accepts a prompt)
- Test: `back/src/modules/worky/voice/voice-concierge.config.spec.ts` (extend), `gemini-token.service.spec.ts` (extend)

**Interfaces:**
- Produces:
  - `buildSetupMessage(model: string, voice: string, opts?: { resumptionHandle?: string; prompt?: string }): Record<string, unknown>` — uses `opts.prompt` when non-blank, else `CONCIERGE_SYSTEM_PROMPT`.
  - `mintSessionToken(opts?: { resumptionHandle?: string; prompt?: string }): Promise<VoiceSessionEnvelope>`

- [ ] **Step 1: Write the failing config test**

Add to `voice-concierge.config.spec.ts` inside the `buildSetupMessage` describe block:

```ts
    it('uses a provided prompt override', () => {
      const s = buildSetupMessage('gemini-live', 'Kore', { prompt: 'Custom persona X' }) as any;
      expect(s.systemInstruction.parts[0].text).toBe('Custom persona X');
    });

    it('falls back to the default prompt when override is blank', () => {
      const s = buildSetupMessage('gemini-live', 'Kore', { prompt: '   ' }) as any;
      expect(s.systemInstruction.parts[0].text).toContain('worky');
    });
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd back && npx jest src/modules/worky/voice/voice-concierge.config.spec.ts`
Expected: FAIL — override ignored (still the default text).

- [ ] **Step 3: Implement the prompt override in `buildSetupMessage`**

In `voice-concierge.config.ts`, change the signature and `systemInstruction`:

```ts
export function buildSetupMessage(
  model: string,
  voice: string,
  opts: { resumptionHandle?: string; prompt?: string } = {},
): Record<string, unknown> {
  const systemText = opts.prompt && opts.prompt.trim().length > 0 ? opts.prompt.trim() : CONCIERGE_SYSTEM_PROMPT;
  return {
    model: `models/${model}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
    systemInstruction: { parts: [{ text: systemText }] },
    tools: [{ functionDeclarations: VOICE_TOOLS }],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    sessionResumption: opts.resumptionHandle ? { handle: opts.resumptionHandle } : {},
    contextWindowCompression: { slidingWindow: {} },
  };
}
```

- [ ] **Step 4: Thread the prompt through `mintSessionToken`**

In `gemini-token.service.ts`, widen the `opts` type and forward it:

```ts
  async mintSessionToken(
    opts: { resumptionHandle?: string; prompt?: string } = {},
  ): Promise<VoiceSessionEnvelope> {
```
and (the `setup:` line is already `buildSetupMessage(this.model, this.voice, opts)` — no change needed since `opts` now carries `prompt`).

- [ ] **Step 5: Add a token-service test for the prompt**

Add to `gemini-token.service.spec.ts`:

```ts
  it('threads a per-stream prompt into the setup', async () => {
    createMock.mockResolvedValue({ name: 'ephemeral-p' });
    const env = await svc().mintSessionToken({ prompt: 'Persona Z' });
    expect((env.setup as any).systemInstruction.parts[0].text).toBe('Persona Z');
  });
```

- [ ] **Step 6: Run both specs to confirm they pass**

Run: `cd back && npx jest src/modules/worky/voice/voice-concierge.config.spec.ts src/modules/worky/voice/gemini-token.service.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add back/src/modules/worky/voice/voice-concierge.config.ts back/src/modules/worky/voice/voice-concierge.config.spec.ts back/src/modules/worky/voice/gemini-token.service.ts back/src/modules/worky/voice/gemini-token.service.spec.ts
git commit -m "feat(worky): apply per-stream prompt override in Gemini setup"
```

---

### Task 3: Voice controller — streamId on session mint + prompt GET/PUT

**Files:**
- Modify: `back/src/modules/worky/voice/dto/voice.dto.ts` (add `streamId` to `CreateVoiceSessionDto`, add `VoicePromptDto`)
- Modify: `back/src/modules/worky/voice/worky-voice.controller.ts` (resolve prompt on mint; add GET/PUT)
- Test: `back/src/modules/worky/voice/worky-voice.controller.spec.ts` (extend)

**Interfaces:**
- Consumes: `WorkyPlanningService.getVoicePrompt/setVoicePrompt` (Task 1); `GeminiTokenService.mintSessionToken({ resumptionHandle, prompt })` (Task 2); `CONCIERGE_SYSTEM_PROMPT` (Task 2 module).
- Produces REST: `GET /worky/voice/prompt/:streamId` → `{ prompt: string; isDefault: boolean }`; `PUT /worky/voice/prompt/:streamId` `{ prompt }` → `{ prompt: string; isDefault: boolean }`; `POST /worky/voice/session` now accepts `{ streamId?, resumptionHandle? }`.

- [ ] **Step 1: Update DTOs**

In `voice.dto.ts`:

```ts
export class CreateVoiceSessionDto {
  @IsOptional() @IsString() @MaxLength(256) streamId?: string;
  @IsOptional() @IsString() @MaxLength(512) resumptionHandle?: string;
}

export class VoicePromptDto {
  @IsString() @MaxLength(8000) prompt!: string;
}
```
(Ensure `IsOptional, IsString, MaxLength` are imported — they already are.)

- [ ] **Step 2: Write the failing controller test**

Add to `worky-voice.controller.spec.ts` (extend the mocks: `planning` already exists — add `getVoicePrompt`/`setVoicePrompt`):

```ts
  it('POST session resolves the per-stream prompt and passes it to mint', async () => {
    planning.getVoicePrompt = jest.fn().mockResolvedValue({ prompt: 'Persona Q' });
    tokens.mintSessionToken.mockResolvedValue({ wsUrl: 'wss://x', setup: {}, expiresAt: 'z' });
    await ctrl.createSession(user, { streamId: 's1', resumptionHandle: 'h1' });
    expect(planning.getVoicePrompt).toHaveBeenCalledWith('u1', 's1');
    expect(tokens.mintSessionToken).toHaveBeenCalledWith({ resumptionHandle: 'h1', prompt: 'Persona Q' });
  });

  it('GET prompt returns default flag when unset', async () => {
    planning.getVoicePrompt = jest.fn().mockResolvedValue({ prompt: null });
    const res = await ctrl.getPrompt(user, 's1');
    expect(res.isDefault).toBe(true);
    expect(res.prompt).toContain('worky');
  });

  it('PUT prompt saves and reports non-default', async () => {
    planning.setVoicePrompt = jest.fn().mockResolvedValue({ prompt: 'Hi' });
    const res = await ctrl.setPrompt(user, 's1', { prompt: 'Hi' });
    expect(planning.setVoicePrompt).toHaveBeenCalledWith('u1', 's1', 'Hi');
    expect(res).toEqual({ prompt: 'Hi', isDefault: false });
  });
```

- [ ] **Step 3: Run to confirm it fails**

Run: `cd back && npx jest src/modules/worky/voice/worky-voice.controller.spec.ts`
Expected: FAIL — `ctrl.getPrompt` is not a function / mint called without prompt.

- [ ] **Step 4: Implement the controller changes**

In `worky-voice.controller.ts`: add imports `Get, Put, Param` from `@nestjs/common`, `CONCIERGE_SYSTEM_PROMPT` from `./voice-concierge.config`, and `VoicePromptDto` from `./dto/voice.dto`. Replace `createSession` and add the two endpoints:

```ts
  @Post('session')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  async createSession(
    @CurrentUser() user: UserDocument,
    @Body() dto: CreateVoiceSessionDto,
  ): Promise<VoiceSessionEnvelope> {
    const prompt = dto.streamId
      ? (await this.planning.getVoicePrompt(user._id.toString(), dto.streamId)).prompt ?? undefined
      : undefined;
    return this.tokens.mintSessionToken({ resumptionHandle: dto.resumptionHandle, prompt });
  }

  @Get('prompt/:streamId')
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  async getPrompt(@CurrentUser() user: UserDocument, @Param('streamId') streamId: string) {
    const { prompt } = await this.planning.getVoicePrompt(user._id.toString(), streamId);
    return { prompt: prompt ?? CONCIERGE_SYSTEM_PROMPT, isDefault: prompt == null };
  }

  @Put('prompt/:streamId')
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  async setPrompt(
    @CurrentUser() user: UserDocument,
    @Param('streamId') streamId: string,
    @Body() dto: VoicePromptDto,
  ) {
    const { prompt } = await this.planning.setVoicePrompt(user._id.toString(), streamId, dto.prompt);
    return { prompt: prompt ?? CONCIERGE_SYSTEM_PROMPT, isDefault: prompt == null };
  }
```

- [ ] **Step 5: Run the spec + typecheck**

Run: `cd back && npx jest src/modules/worky/voice/worky-voice.controller.spec.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS; 0 type errors.

- [ ] **Step 6: Commit**

```bash
git add back/src/modules/worky/voice/dto/voice.dto.ts back/src/modules/worky/voice/worky-voice.controller.ts back/src/modules/worky/voice/worky-voice.controller.spec.ts
git commit -m "feat(worky): voice session resolves per-stream prompt; prompt GET/PUT endpoints"
```

---

### Task 4: Frontend voice API — streamId + prompt get/set

**Files:**
- Modify: `front/src/lib/api/config.ts` (add `voicePrompt` endpoint)
- Modify: `front/src/modules/worky/api.ts` (`createVoiceSession` gains streamId; add `getVoicePrompt`/`setVoicePrompt`)
- Modify: `front/src/modules/worky/voice/useRealtimeVoiceSession.ts` (pass streamId to `createVoiceSession`)
- Test: `front/src/modules/worky/api.voice.test.ts` (extend)

**Interfaces:**
- Produces:
  - `createVoiceSession(streamId: string, resumptionHandle?: string): Promise<VoiceSessionEnvelope>`
  - `getVoicePrompt(streamId: string): Promise<{ prompt: string; isDefault: boolean }>`
  - `setVoicePrompt(streamId: string, prompt: string): Promise<{ prompt: string; isDefault: boolean }>`

- [ ] **Step 1: Add the endpoint**

In `front/src/lib/api/config.ts` under `API_ENDPOINTS.worky`:

```ts
    voicePrompt: (streamId: string) => `/worky/voice/prompt/${streamId}`,
```

- [ ] **Step 2: Write the failing test**

Add to `api.voice.test.ts`:

```ts
  it('createVoiceSession posts streamId + handle', async () => {
    (apiClient.post as any).mockResolvedValue({ data: { data: { wsUrl: 'wss://x', setup: {}, expiresAt: 'z' } } });
    await createVoiceSession('s1', 'h1');
    expect(apiClient.post).toHaveBeenCalledWith('/worky/voice/session', { streamId: 's1', resumptionHandle: 'h1' });
  });

  it('getVoicePrompt GETs the per-stream prompt', async () => {
    (apiClient.get as any) = vi.fn().mockResolvedValue({ data: { data: { prompt: 'p', isDefault: false } } });
    const res = await getVoicePrompt('s1');
    expect(apiClient.get).toHaveBeenCalledWith('/worky/voice/prompt/s1');
    expect(res.prompt).toBe('p');
  });

  it('setVoicePrompt PUTs the prompt', async () => {
    (apiClient.put as any) = vi.fn().mockResolvedValue({ data: { data: { prompt: 'p2', isDefault: false } } });
    const res = await setVoicePrompt('s1', 'p2');
    expect(apiClient.put).toHaveBeenCalledWith('/worky/voice/prompt/s1', { prompt: 'p2' });
    expect(res.prompt).toBe('p2');
  });
```
Add `getVoicePrompt, setVoicePrompt` to the import at the top of the test and ensure the `vi.mock('@/lib/api/client')` default includes `get`/`put`: change the mock to `{ default: { post: vi.fn(), get: vi.fn(), put: vi.fn() } }`.

- [ ] **Step 3: Run to confirm it fails**

Run: `cd front && npx vitest run src/modules/worky/api.voice.test.ts`
Expected: FAIL — new functions/signatures missing.

- [ ] **Step 4: Implement the API changes**

In `front/src/modules/worky/api.ts`, change `createVoiceSession` and add the two prompt functions:

```ts
export async function createVoiceSession(streamId: string, resumptionHandle?: string): Promise<VoiceSessionEnvelope> {
  const res = await apiClient.post<ApiResponse<VoiceSessionEnvelope>>(API_ENDPOINTS.worky.voiceSession, {
    streamId,
    resumptionHandle,
  });
  return unwrap(res);
}

export async function getVoicePrompt(streamId: string): Promise<{ prompt: string; isDefault: boolean }> {
  const res = await apiClient.get<ApiResponse<{ prompt: string; isDefault: boolean }>>(
    API_ENDPOINTS.worky.voicePrompt(streamId),
  );
  return unwrap(res);
}

export async function setVoicePrompt(streamId: string, prompt: string): Promise<{ prompt: string; isDefault: boolean }> {
  const res = await apiClient.put<ApiResponse<{ prompt: string; isDefault: boolean }>>(
    API_ENDPOINTS.worky.voicePrompt(streamId),
    { prompt },
  );
  return unwrap(res);
}
```

- [ ] **Step 5: Update the hook call site**

In `useRealtimeVoiceSession.ts`, change the `connect` call:

```ts
    const envelope = await createVoiceSession(streamId, handleRef.current);
```

- [ ] **Step 6: Run the test + typecheck**

Run: `cd front && npx vitest run src/modules/worky/api.voice.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS; 0 type errors.

- [ ] **Step 7: Commit**

```bash
git add front/src/lib/api/config.ts front/src/modules/worky/api.ts front/src/modules/worky/voice/useRealtimeVoiceSession.ts front/src/modules/worky/api.voice.test.ts
git commit -m "feat(worky): frontend voice API carries streamId + prompt get/set"
```

---

### Task 5: Shared `useWorkyVoiceSession` hook + refactor VoiceSession

**Files:**
- Create: `front/src/modules/worky/voice/useWorkyVoiceSession.ts`
- Modify: `front/src/modules/worky/components/voice/VoiceSession.tsx` (consume the shared hook)
- Test: `front/src/modules/worky/voice/useWorkyVoiceSession.test.tsx` (create)

**Interfaces:**
- Consumes: `useRealtimeVoiceSession`, `useVoiceSession`, `useVoiceSettings` (existing).
- Produces: `useWorkyVoiceSession(streamId: string, active: boolean): VoiceSessionApi & { usingRealtime: boolean }` — instantiates both engines, selects realtime unless it errored (then falls back to legacy), and starts/stops the active engine whenever `active` flips.

- [ ] **Step 1: Write the failing test**

Create `front/src/modules/worky/voice/useWorkyVoiceSession.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const realtimeApi = { state: 'idle', transcript: {}, level: 0, muted: false, error: null as string | null, start: vi.fn(), stop: vi.fn(), toggleMute: vi.fn(), submitTurn: vi.fn(), cancelTurn: vi.fn(), beginTake: vi.fn(), interrupt: vi.fn() };
const legacyApi = { ...realtimeApi, start: vi.fn(), stop: vi.fn() };

vi.mock('./useRealtimeVoiceSession', () => ({ useRealtimeVoiceSession: () => realtimeApi }));
vi.mock('./useVoiceSession', () => ({ useVoiceSession: () => legacyApi }));
vi.mock('./voiceSettings', () => ({ useVoiceSettings: (sel: any) => sel({ realtimeVoice: true }) }));

import { useWorkyVoiceSession } from './useWorkyVoiceSession';

describe('useWorkyVoiceSession', () => {
  it('starts the realtime engine when active and reports usingRealtime', () => {
    const { result } = renderHook(() => useWorkyVoiceSession('s1', true));
    expect(result.current.usingRealtime).toBe(true);
    expect(realtimeApi.start).toHaveBeenCalled();
  });

  it('does not start when inactive', () => {
    legacyApi.start.mockClear();
    renderHook(() => useWorkyVoiceSession('s1', false));
    expect(legacyApi.start).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd front && npx vitest run src/modules/worky/voice/useWorkyVoiceSession.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the shared hook**

Create `front/src/modules/worky/voice/useWorkyVoiceSession.ts` (lifts the logic verbatim from `VoiceSession.tsx:71-105`, gating on `active` instead of `open`):

```ts
import { useEffect, useRef, useState } from 'react';
import type { VoiceSessionApi } from './useVoiceSession';
import { useVoiceSession } from './useVoiceSession';
import { useRealtimeVoiceSession } from './useRealtimeVoiceSession';
import { useVoiceSettings } from './voiceSettings';

export function useWorkyVoiceSession(
  streamId: string,
  active: boolean,
): VoiceSessionApi & { usingRealtime: boolean } {
  const realtimeVoice = useVoiceSettings((s) => s.realtimeVoice);
  const [fellBack, setFellBack] = useState(false);
  const useRealtime = realtimeVoice && !fellBack;

  const realtime = useRealtimeVoiceSession(useRealtime ? streamId : '');
  const legacy = useVoiceSession(useRealtime ? '' : streamId);
  const session = useRealtime ? realtime : legacy;

  useEffect(() => {
    if (realtimeVoice && realtime.error && !fellBack) setFellBack(true);
  }, [realtimeVoice, realtime.error, fellBack]);

  const startRef = useRef(session.start);
  const stopRef = useRef(session.stop);
  startRef.current = session.start;
  stopRef.current = session.stop;

  useEffect(() => {
    if (!active) return undefined;
    const startNow = startRef.current;
    const stopThis = stopRef.current;
    startNow();
    return () => stopThis();
  }, [active, useRealtime]);

  return { ...session, usingRealtime: useRealtime };
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `cd front && npx vitest run src/modules/worky/voice/useWorkyVoiceSession.test.tsx`
Expected: PASS.

- [ ] **Step 5: Refactor `VoiceSession.tsx` to use the shared hook**

Replace lines 71-105 (the selection + start/stop effect) with:

```ts
  const { state, transcript, level, muted, error, toggleMute, submitTurn, cancelTurn, beginTake, usingRealtime } =
    useWorkyVoiceSession(streamId, open);
  const turnMode = useVoiceSettings((s) => s.turnMode);
  const threshold = useVoiceSettings((s) => s.speechThreshold);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const end = (): void => {
    onOpenChange(false);
  };
```
Update the import block: remove `useRealtimeVoiceSession`/`useVoiceSession`/`useRef`/`useEffect` if now unused (keep `useState`; `useVoiceSettings` still used); add `import { useWorkyVoiceSession } from '../../voice/useWorkyVoiceSession';`. The existing `!useRealtime` guards on the turn controls become `!usingRealtime`.

- [ ] **Step 6: Run the mobile VoiceSession test + typecheck**

Run: `cd front && npx vitest run src/modules/worky/components/voice/VoiceSession.test.tsx && npx tsc --noEmit -p tsconfig.json`
Expected: PASS; 0 type errors.

- [ ] **Step 7: Commit**

```bash
git add front/src/modules/worky/voice/useWorkyVoiceSession.ts front/src/modules/worky/voice/useWorkyVoiceSession.test.tsx front/src/modules/worky/components/voice/VoiceSession.tsx
git commit -m "feat(worky): shared useWorkyVoiceSession hook; VoiceSession consumes it"
```

---

### Task 6: Concierge instructions dialog

**Files:**
- Create: `front/src/modules/worky/components/voice/ConciergeInstructionsDialog.tsx`
- Modify: `front/src/modules/worky/locales/en.json`, `fr.json` (dialog copy)
- Test: `front/src/modules/worky/components/voice/ConciergeInstructionsDialog.test.tsx`

**Interfaces:**
- Consumes: `getVoicePrompt`, `setVoicePrompt` (Task 4); shadcn `Dialog`, `Textarea`, `Button`.
- Produces: `ConciergeInstructionsDialog({ streamId, open, onOpenChange }: { streamId: string; open: boolean; onOpenChange: (open: boolean) => void }): JSX.Element`

- [ ] **Step 1: Add locale keys**

In `en.json` add:
```json
  "voicePrompt.title": "Concierge instructions",
  "voicePrompt.description": "Customize how the voice concierge behaves for this stream. Applies the next time you start voice.",
  "voicePrompt.reset": "Reset to default",
  "voicePrompt.save": "Save",
  "voicePrompt.default": "Using the default instructions.",
```
In `fr.json` add:
```json
  "voicePrompt.title": "Instructions du concierge",
  "voicePrompt.description": "Personnalisez le comportement du concierge vocal pour ce flux. Appliqué au prochain démarrage de la voix.",
  "voicePrompt.reset": "Réinitialiser",
  "voicePrompt.save": "Enregistrer",
  "voicePrompt.default": "Utilise les instructions par défaut.",
```

- [ ] **Step 2: Write the failing test**

Create `ConciergeInstructionsDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import * as api from '../../api';

vi.mock('../../api');
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (k: string) => k }) }));

import { ConciergeInstructionsDialog } from './ConciergeInstructionsDialog';

describe('ConciergeInstructionsDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads the current prompt when opened', async () => {
    (api.getVoicePrompt as any).mockResolvedValue({ prompt: 'current text', isDefault: false });
    render(<ConciergeInstructionsDialog streamId="s1" open onOpenChange={() => {}} />);
    await waitFor(() => expect(api.getVoicePrompt).toHaveBeenCalledWith('s1'));
    expect(await screen.findByDisplayValue('current text')).toBeTruthy();
  });

  it('saves the edited prompt', async () => {
    (api.getVoicePrompt as any).mockResolvedValue({ prompt: 'a', isDefault: false });
    (api.setVoicePrompt as any).mockResolvedValue({ prompt: 'b', isDefault: false });
    render(<ConciergeInstructionsDialog streamId="s1" open onOpenChange={() => {}} />);
    const box = await screen.findByRole('textbox');
    fireEvent.change(box, { target: { value: 'b' } });
    fireEvent.click(screen.getByText('voicePrompt.save'));
    await waitFor(() => expect(api.setVoicePrompt).toHaveBeenCalledWith('s1', 'b'));
  });
});
```

- [ ] **Step 3: Run to confirm it fails**

Run: `cd front && npx vitest run src/modules/worky/components/voice/ConciergeInstructionsDialog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the dialog**

Create `ConciergeInstructionsDialog.tsx`:

```tsx
import { useEffect, useState, type JSX } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { getVoicePrompt, setVoicePrompt } from '../../api';

export function ConciergeInstructionsDialog({
  streamId,
  open,
  onOpenChange,
}: {
  streamId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const [text, setText] = useState('');
  const [isDefault, setIsDefault] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !streamId) return;
    let cancelled = false;
    void getVoicePrompt(streamId)
      .then((r) => {
        if (cancelled) return;
        setText(r.prompt);
        setIsDefault(r.isDefault);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, streamId]);

  const save = async (value: string): Promise<void> => {
    setSaving(true);
    try {
      const r = await setVoicePrompt(streamId, value);
      setText(r.prompt);
      setIsDefault(r.isDefault);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('voicePrompt.title')}</DialogTitle>
          <DialogDescription>{t('voicePrompt.description')}</DialogDescription>
        </DialogHeader>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} className="min-h-48" />
        {isDefault ? <p className="text-xs text-muted-foreground">{t('voicePrompt.default')}</p> : null}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={saving} onClick={() => void save('')}>
            {t('voicePrompt.reset')}
          </Button>
          <Button type="button" disabled={saving} onClick={() => void save(text)}>
            {t('voicePrompt.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd front && npx vitest run src/modules/worky/components/voice/ConciergeInstructionsDialog.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add front/src/modules/worky/components/voice/ConciergeInstructionsDialog.tsx front/src/modules/worky/components/voice/ConciergeInstructionsDialog.test.tsx front/src/modules/worky/locales/en.json front/src/modules/worky/locales/fr.json
git commit -m "feat(worky): concierge instructions dialog (per-stream prompt editor)"
```

---

### Task 7: Inline live dock + wire into WorkyStreamPage

**Files:**
- Rewrite: `front/src/modules/worky/components/desktop/WorkyVoiceDock.tsx` (idle pill + live control)
- Modify: `front/src/modules/worky/components/WorkyStreamPage.tsx` (host the shared hook; remove desktop `<VoiceSession>`; render dock + settings + prompt dialog)
- Modify: `front/src/modules/worky/locales/en.json`, `fr.json` (`voice.stop` if missing)
- Test: `front/src/modules/worky/components/desktop/WorkyVoiceDock.test.tsx` (create)

**Interfaces:**
- Consumes: `VoiceState`, `useWorkyVoiceSession` (Task 5), `VoiceSettingsSheet`, `ConciergeInstructionsDialog` (Task 6), `useWorkyUiStore` (`voiceOpen`/`setVoiceOpen` repurposed as "voice active").
- Produces: `WorkyVoiceDock({ state, level, muted, active, onToggle, onMute, onOpenSettings, onOpenPrompt }: WorkyVoiceDockProps): JSX.Element`.

- [ ] **Step 1: Write the failing dock test**

Create `WorkyVoiceDock.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (k: string) => k }) }));
import { WorkyVoiceDock } from './WorkyVoiceDock';

const base = { state: 'idle' as const, level: 0, muted: false, active: false, onToggle: vi.fn(), onMute: vi.fn(), onOpenSettings: vi.fn(), onOpenPrompt: vi.fn() };

describe('WorkyVoiceDock', () => {
  it('idle: clicking the pill starts voice', () => {
    const onToggle = vi.fn();
    render(<WorkyVoiceDock {...base} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'nav.voice' }));
    expect(onToggle).toHaveBeenCalled();
  });

  it('active: shows a live state label and a hang-up control', () => {
    render(<WorkyVoiceDock {...base} active state="listening" />);
    expect(screen.getByTestId('voice-dock-live')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'voice.end' }));
    expect(base.onToggle).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd front && npx vitest run src/modules/worky/components/desktop/WorkyVoiceDock.test.tsx`
Expected: FAIL — new props/markup missing.

- [ ] **Step 3: Rewrite the dock**

Replace `WorkyVoiceDock.tsx` with an idle-or-live presentational component:

```tsx
import type { JSX } from 'react';
import { Mic, MicOff, PhoneOff, Settings2, MessageSquareText } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { cn } from '@/lib/utils';
import type { VoiceState } from '../../voice/useVoiceSession';

export interface WorkyVoiceDockProps {
  state: VoiceState;
  level: number;
  muted: boolean;
  active: boolean;
  onToggle: () => void;
  onMute: () => void;
  onOpenSettings: () => void;
  onOpenPrompt: () => void;
}

const STATE_LABEL: Record<VoiceState, string> = {
  idle: 'voice.idle',
  listening: 'voice.listening',
  thinking: 'voice.thinking',
  speaking: 'voice.speaking',
};

export function WorkyVoiceDock({
  state,
  level,
  muted,
  active,
  onToggle,
  onMute,
  onOpenSettings,
  onOpenPrompt,
}: WorkyVoiceDockProps): JSX.Element {
  const { t } = useModuleTranslation('worky');

  if (!active) {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-20 flex justify-center">
        <button
          type="button"
          onClick={onToggle}
          aria-label={t('nav.voice')}
          className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-card/95 py-2 pr-2 pl-4 shadow-lg backdrop-blur transition-colors hover:bg-accent/40"
        >
          <span className="flex flex-col text-left">
            <span className="text-sm font-semibold text-foreground">{t('voice.manager')}</span>
            <span className="text-xs text-muted-foreground">{t('voice.tapToTalk')}</span>
          </span>
          <span className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
            <Mic className="size-5" />
          </span>
        </button>
      </div>
    );
  }

  // Pulse scale driven by live input level while listening.
  const pulse = state === 'listening' ? 1 + Math.min(0.4, level * 0.8) : state === 'speaking' ? 1.15 : 1;

  return (
    <div
      data-testid="voice-dock-live"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-20 flex justify-center"
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-card/95 py-2 pr-2 pl-4 shadow-lg backdrop-blur">
        <span
          className={cn(
            'flex size-10 items-center justify-center rounded-full text-primary-foreground shadow transition-transform',
            state === 'speaking' ? 'bg-primary animate-pulse' : 'bg-primary',
          )}
          style={{ transform: `scale(${pulse})` }}
        >
          <Mic className="size-4" />
        </span>
        <span className="min-w-24 text-sm font-semibold text-foreground">
          {muted ? t('voice.muted') : t(STATE_LABEL[state])}
        </span>
        <button type="button" aria-label={t('voicePrompt.title')} onClick={onOpenPrompt} className="flex size-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
          <MessageSquareText className="size-4" />
        </button>
        <button type="button" aria-label={t('voiceSettings.title')} onClick={onOpenSettings} className="flex size-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
          <Settings2 className="size-4" />
        </button>
        <button type="button" aria-label={muted ? t('voice.unmute') : t('voice.mute')} onClick={onMute} className="flex size-9 items-center justify-center rounded-full border border-border bg-card text-foreground">
          {muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
        </button>
        <button type="button" aria-label={t('voice.end')} onClick={onToggle} className="flex size-10 items-center justify-center rounded-full bg-destructive text-white">
          <PhoneOff className="size-4" />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the dock test to confirm it passes**

Run: `cd front && npx vitest run src/modules/worky/components/desktop/WorkyVoiceDock.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire into `WorkyStreamPage.tsx`**

Add imports:
```ts
import { useState } from 'react';
import { WorkyVoiceDock } from './desktop/WorkyVoiceDock';
import { useWorkyVoiceSession } from '../voice/useWorkyVoiceSession';
import { VoiceSettingsSheet } from './voice/VoiceSettingsSheet';
import { ConciergeInstructionsDialog } from './voice/ConciergeInstructionsDialog';
```
Remove the `import { VoiceSession } from './voice/VoiceSession';` line. **The hook MUST be called before the `if (isMobile) return ...` early return (line ~286)** — place it right after the store selectors (~line 279). Gate `active` on `!isMobile` so mobile (which runs its own session inside `WorkyMobileStream`→`VoiceSession`) doesn't double-instantiate:
```ts
  const voice = useWorkyVoiceSession(streamId, voiceOpen && !isMobile);
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
```
(`isMobile` is the same value used by the mobile early return at `WorkyStreamPage.tsx:286`.)
Replace the JSX block at lines 396-402 with:
```tsx
      <WorkyVoiceDock
        state={voice.state}
        level={voice.level}
        muted={voice.muted}
        active={voiceOpen}
        onToggle={() => setVoiceOpen(!voiceOpen)}
        onMute={voice.toggleMute}
        onOpenSettings={() => setVoiceSettingsOpen(true)}
        onOpenPrompt={() => setPromptOpen(true)}
      />
      <VoiceSettingsSheet open={voiceSettingsOpen} onOpenChange={setVoiceSettingsOpen} level={voice.level} />
      <ConciergeInstructionsDialog streamId={streamId} open={promptOpen} onOpenChange={setPromptOpen} />
```

- [ ] **Step 6: Full frontend verification**

Run: `cd front && npx vitest run src/modules/worky/ && npx tsc --noEmit -p tsconfig.json`
Expected: all worky tests PASS; 0 type errors.

- [ ] **Step 7: Commit**

```bash
git add front/src/modules/worky/components/desktop/WorkyVoiceDock.tsx front/src/modules/worky/components/desktop/WorkyVoiceDock.test.tsx front/src/modules/worky/components/WorkyStreamPage.tsx front/src/modules/worky/locales/en.json front/src/modules/worky/locales/fr.json
git commit -m "feat(worky): inline live voice dock on desktop stream; remove full-screen takeover"
```

---

### Task 8: Manual verification

**Files:**
- Modify: `docs/superpowers/verification/2026-08-10-worky-voice-concierge-manual-check.md` (append an inline-voice + prompt section)

- [ ] **Step 1: Manual test (record results)**

With backend restarted + frontend rebuilt, on a desktop worky stream verify: (a) clicking the dock starts voice inline with no full-screen sheet, and the stream stays visible/scrollable; (b) the dock mic animates between idle/listening/speaking; (c) hang-up stops voice; (d) the gear opens voice settings, the message icon opens the Concierge instructions dialog; (e) editing + Save persists (reload the page, reopen the dialog → the text is retained); (f) Reset to default clears it (dialog shows the default note); (g) start voice again → the saved persona takes effect (behavior reflects the custom prompt); (h) on a phone viewport, the mobile full-screen sheet still works.

- [ ] **Step 2: Commit the verification record**

```bash
git add docs/superpowers/verification/2026-08-10-worky-voice-concierge-manual-check.md
git commit -m "docs(worky): manual verification for inline voice + per-stream prompt"
```

---

## Notes for the implementer

- The desktop `pb-28` padding at `WorkyStreamPage.tsx:~351` clears the fixed dock; the live dock is the same footprint, so leave it.
- `VoiceSettingsSheet` is fully controlled (`open`/`onOpenChange`/optional `level`) — pass `voice.level`.
- The dock is presentational (no hooks beyond i18n) so it stays unit-testable; all session state comes from `WorkyStreamPage` via `useWorkyVoiceSession`.
- Legacy fallback in the dock: when `voice.usingRealtime` is false the mic still animates on `state`, but always-listening won't apply; a press-to-talk affordance for the legacy path is deferred (realtime is the default and the fallback is rare) — note this in the manual check if you hit it.
