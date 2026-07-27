# Per-stream Planner/Executor Prompts & Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each worky stream four persisted, user-editable settings — planner model, executor model, planner prompt, executor prompt — and send them to the worky orchestrator over gRPC using the updated `companion_ai.proto`.

**Architecture:** Add four new fields (`plannerModelId`, `executorModelId`, `plannerPrompt`, `executorPrompt`) to the worky stream document, DTO, and API response. Persist them via the existing PATCH `/worky/streams/{id}` path. On each `RunTask` kickoff/resume, read them and map them onto the renamed/added proto fields (`planner_model`, `executor_model`, `planner_prompt`, `executor_prompt`). The existing `managerModelId`/`workerModelId` fields stay in the schema and keep feeding the separate HTTP planning-turn path (Path B) untouched. The frontend edits all four from an expanded card in the OrchestratorPanel Details tab.

**Tech Stack:** NestJS + Mongoose + `@grpc/grpc-js`/`@grpc/proto-loader` (backend); React + TanStack Query + i18next + Vitest/Testing Library (frontend). Backend tests: Jest.

## Global Constraints

- **Prompt max length: 40 000 chars** (schema `maxlength`, DTO `@MaxLength`, textarea `maxLength`) — exact value everywhere.
- **Model id max length: 256 chars** (matches existing `managerModelId`).
- **PATCH semantics:** field omitted = unchanged; explicit `null` = clear (use server/admin default); non-empty string = set. Empty/whitespace string normalizes to `null`.
- **gRPC scope only:** wire the new fields into the gRPC `RunTask` (and `DeliverMailReply` payload shape). Do NOT modify the HTTP planning-turn path (`worky-planning.service.ts`) or repoint `managerModelId`/`workerModelId`.
- **Model id semantics:** all model fields store a **LiteLLM model identifier** (e.g. `openai/gpt-4o-mini`), never the admin DB model id.
- **No Co-Authored-By trailer** on commits.
- Backend tests run from `back/`: `npm test -- <path>`. Frontend tests run from `front/`: `npm test -- <path>` (Vitest).

---

### Task 1: Persist the four fields on the stream (schema, interface, create, response)

**Files:**
- Modify: `back/src/modules/worky/schemas/worky-stream.schema.ts` (after line 58)
- Modify: `back/src/modules/worky/interfaces/worky-stream.interface.ts` (after line 12)
- Modify: `back/src/modules/worky/services/worky-stream.service.ts` (`create()` ~line 123-124; `toResponse()` ~line 502-503)
- Test: `back/src/modules/worky/services/worky-stream.service.spec.ts` (extend the `WorkyStreamService.create` describe, ~line 141)

**Interfaces:**
- Produces: `WorkyStream` schema + `IWorkyStreamResponse` each gain
  `plannerModelId?: string | null`, `executorModelId?: string | null`,
  `plannerPrompt?: string | null`, `executorPrompt?: string | null`.
  `create()` defaults all four to `null`; `toResponse()` emits all four
  (`?? null`). Consumed by Tasks 2 and 4.

- [ ] **Step 1: Add the failing test** — in `worky-stream.service.spec.ts`, inside the existing `describe('WorkyStreamService.create', …)`, add after the existing `'defaults per-stream model ids to null'` test (~line 147):

```ts
  it('defaults planner/executor models and prompts to null', async () => {
    streamModel.create.mockImplementation((doc: Record<string, unknown>) => {
      streamInput = doc;
      return Promise.resolve(makeStreamDoc(doc));
    });

    const result = await service.create(userId, { title: 'with-agent-config' });

    expect(streamInput.plannerModelId).toBeNull();
    expect(streamInput.executorModelId).toBeNull();
    expect(streamInput.plannerPrompt).toBeNull();
    expect(streamInput.executorPrompt).toBeNull();
    expect(result.plannerModelId).toBeNull();
    expect(result.executorModelId).toBeNull();
    expect(result.plannerPrompt).toBeNull();
    expect(result.executorPrompt).toBeNull();
  });
```

> Note: reuse the exact `streamModel.create` mock / `makeStreamDoc` / `streamInput` helpers already used by the neighbouring `'defaults per-stream model ids to null'` test in this file. If that test uses a different mock variable name than `streamInput`/`makeStreamDoc`, mirror whatever it uses — do not invent new helpers.

- [ ] **Step 2: Run the test to verify it fails**

Run (from `back/`): `npm test -- worky-stream.service.spec.ts -t "defaults planner/executor"`
Expected: FAIL — `result.plannerModelId` is `undefined`, not `null`.

- [ ] **Step 3: Add the schema fields** — in `worky-stream.schema.ts`, immediately after the `workerModelId` prop (line 58):

```ts
  @Prop({ type: String, default: null, trim: true, maxlength: 256 })
  plannerModelId?: string | null;

  @Prop({ type: String, default: null, trim: true, maxlength: 256 })
  executorModelId?: string | null;

  @Prop({ type: String, default: null, maxlength: 40000 })
  plannerPrompt?: string | null;

  @Prop({ type: String, default: null, maxlength: 40000 })
  executorPrompt?: string | null;
```

- [ ] **Step 4: Add the interface fields** — in `worky-stream.interface.ts`, after line 12 (`workerModelId?: string | null;`):

```ts
  plannerModelId?: string | null;
  executorModelId?: string | null;
  plannerPrompt?: string | null;
  executorPrompt?: string | null;
```

- [ ] **Step 5: Default them in `create()`** — in `worky-stream.service.ts`, in the `this.streamModel.create({ … })` object, right after `workerModelId: null,` (line 124):

```ts
      plannerModelId: null,
      executorModelId: null,
      plannerPrompt: null,
      executorPrompt: null,
```

- [ ] **Step 6: Emit them in `toResponse()`** — in `worky-stream.service.ts`, after the `workerModelId` line (line 503):

```ts
      plannerModelId: (doc.plannerModelId as string | null | undefined) ?? null,
      executorModelId: (doc.executorModelId as string | null | undefined) ?? null,
      plannerPrompt: (doc.plannerPrompt as string | null | undefined) ?? null,
      executorPrompt: (doc.executorPrompt as string | null | undefined) ?? null,
```

- [ ] **Step 7: Run the test to verify it passes**

Run (from `back/`): `npm test -- worky-stream.service.spec.ts -t "defaults planner/executor"`
Expected: PASS.

- [ ] **Step 8: Run the whole stream-service spec to confirm no regressions**

Run: `npm test -- worky-stream.service.spec.ts`
Expected: PASS (all existing tests still green).

- [ ] **Step 9: Commit**

```bash
git add back/src/modules/worky/schemas/worky-stream.schema.ts back/src/modules/worky/interfaces/worky-stream.interface.ts back/src/modules/worky/services/worky-stream.service.ts back/src/modules/worky/services/worky-stream.service.spec.ts
git commit -m "feat(worky): persist planner/executor model + prompt fields on stream"
```

---

### Task 2: Accept the four fields in the update DTO and `patch()`

**Files:**
- Modify: `back/src/modules/worky/dto/update-worky-stream.dto.ts` (after line 46)
- Modify: `back/src/modules/worky/services/worky-stream.service.ts` (`patch()`, after line 325)
- Test: `back/src/modules/worky/services/worky-stream.service.spec.ts` (extend the `WorkyStreamService.patch` describe, ~line 365)

**Interfaces:**
- Consumes: the four fields from Task 1.
- Produces: `UpdateWorkyStreamDto` accepts `plannerModelId?`, `executorModelId?`,
  `plannerPrompt?`, `executorPrompt?` (each `string | null`); `patch()` persists
  them with the trim→null normalization. Consumed by the frontend (Task 5).

- [ ] **Step 1: Add the failing test** — in `worky-stream.service.spec.ts`, inside `describe('WorkyStreamService.patch …')`, after the existing `'persists managerModelId and workerModelId'` test (~line 373):

```ts
  it('persists planner/executor models and prompts from the PATCH DTO', async () => {
    const result = await service.patch(userId, streamObjectId.toString(), {
      plannerModelId: 'openai/gpt-4o',
      executorModelId: 'anthropic/claude-3-5-sonnet',
      plannerPrompt: 'You are the planner.',
      executorPrompt: 'You are an executor.',
    });
    expect(result.plannerModelId).toBe('openai/gpt-4o');
    expect(result.executorModelId).toBe('anthropic/claude-3-5-sonnet');
    expect(result.plannerPrompt).toBe('You are the planner.');
    expect(result.executorPrompt).toBe('You are an executor.');
  });

  it('clears a prompt when passed an empty string', async () => {
    savedStream.plannerPrompt = 'old prompt';
    const result = await service.patch(userId, streamObjectId.toString(), {
      plannerPrompt: '   ',
    });
    expect(result.plannerPrompt).toBeNull();
  });
```

> Note: use the same `savedStream` / `streamObjectId` / `userId` fixtures the neighbouring patch tests use (see the `beforeEach` of the `patch` describe, ~line 291-363). If the fixture that backs the mutable stream doc has a different name than `savedStream`, mirror it.

- [ ] **Step 2: Run the test to verify it fails**

Run (from `back/`): `npm test -- worky-stream.service.spec.ts -t "planner/executor models and prompts from the PATCH"`
Expected: FAIL — `result.plannerModelId` is `undefined`/`null`, prompts not applied.

- [ ] **Step 3: Add the DTO fields** — in `update-worky-stream.dto.ts`, after the `workerModelId` field (line 46), before the closing brace:

```ts

  @ApiPropertyOptional({
    description:
      'LiteLLM model identifier for the Planner. Pass null to clear and fall back to the admin default.',
    maxLength: 256,
    nullable: true,
  })
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsOptional()
  @IsString()
  @MaxLength(256)
  plannerModelId?: string | null;

  @ApiPropertyOptional({
    description:
      'LiteLLM model identifier for Executors. Pass null to clear and fall back to the admin default.',
    maxLength: 256,
    nullable: true,
  })
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsOptional()
  @IsString()
  @MaxLength(256)
  executorModelId?: string | null;

  @ApiPropertyOptional({
    description:
      'System prompt override for the Planner. Pass null/empty to use the server default.',
    maxLength: 40000,
    nullable: true,
  })
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsOptional()
  @IsString()
  @MaxLength(40000)
  plannerPrompt?: string | null;

  @ApiPropertyOptional({
    description:
      'System prompt override for Executors. Pass null/empty to use the server default.',
    maxLength: 40000,
    nullable: true,
  })
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsOptional()
  @IsString()
  @MaxLength(40000)
  executorPrompt?: string | null;
```

- [ ] **Step 4: Add the `patch()` branches** — in `worky-stream.service.ts`, in `patch()`, immediately after the `workerModelId` branch closes (after line 325, before `await stream.save();`):

```ts
    if (dto.plannerModelId !== undefined) {
      const next =
        typeof dto.plannerModelId === 'string' && dto.plannerModelId.trim()
          ? dto.plannerModelId.trim()
          : null;
      if (next !== (stream.plannerModelId ?? null)) {
        stream.plannerModelId = next;
        stream.lastActivityAt = new Date();
      }
    }
    if (dto.executorModelId !== undefined) {
      const next =
        typeof dto.executorModelId === 'string' && dto.executorModelId.trim()
          ? dto.executorModelId.trim()
          : null;
      if (next !== (stream.executorModelId ?? null)) {
        stream.executorModelId = next;
        stream.lastActivityAt = new Date();
      }
    }
    if (dto.plannerPrompt !== undefined) {
      const next =
        typeof dto.plannerPrompt === 'string' && dto.plannerPrompt.trim()
          ? dto.plannerPrompt
          : null;
      if (next !== (stream.plannerPrompt ?? null)) {
        stream.plannerPrompt = next;
        stream.lastActivityAt = new Date();
      }
    }
    if (dto.executorPrompt !== undefined) {
      const next =
        typeof dto.executorPrompt === 'string' && dto.executorPrompt.trim()
          ? dto.executorPrompt
          : null;
      if (next !== (stream.executorPrompt ?? null)) {
        stream.executorPrompt = next;
        stream.lastActivityAt = new Date();
      }
    }
```

> Note the prompt branches store the raw `dto.plannerPrompt` (not trimmed) when non-empty — we only use `.trim()` to decide empty-vs-set, preserving intentional leading/trailing whitespace in a real prompt. Model branches trim (ids never have meaningful whitespace), matching the existing `managerModelId` branch.

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `back/`): `npm test -- worky-stream.service.spec.ts -t "PATCH"`
Then: `npm test -- worky-stream.service.spec.ts -t "clears a prompt"`
Expected: PASS.

- [ ] **Step 6: Run the whole stream-service spec**

Run: `npm test -- worky-stream.service.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add back/src/modules/worky/dto/update-worky-stream.dto.ts back/src/modules/worky/services/worky-stream.service.ts back/src/modules/worky/services/worky-stream.service.spec.ts
git commit -m "feat(worky): accept planner/executor model + prompt in stream PATCH"
```

---

### Task 3: Map the new fields onto the gRPC RunTask / DeliverMailReply request (+ ship the proto)

**Files:**
- Modify: `back/src/modules/worky/services/worky-orchestrator.grpc-client.service.ts` (`runTask` lines 158-194; `deliverMailReply` lines 258-289)
- Modify: `back/package.json` (`postbuild` script, line 10 — add a `companion_ai.proto` copy block)
- Test: `back/src/modules/worky/services/worky-orchestrator.grpc-client.service.spec.ts` (update the two `runTask` request-shape tests, lines 77-112)

**Interfaces:**
- Consumes: nothing from earlier tasks (pure transport).
- Produces: `runTask(userId, sessionId, message, opts)` where `opts` is
  `{ plannerModel?: string; executorModel?: string; plannerPrompt?: string; executorPrompt?: string; skills?: unknown[]; connectors?: unknown[] }`.
  The request carries snake_case `planner_model`, `executor_model`,
  `planner_prompt`, `executor_prompt` (each set only when truthy); the old
  `model` key is gone. `deliverMailReply` input gains optional `executorPrompt`
  → `executor_prompt`. Consumed by Task 4.

- [ ] **Step 1: Update the failing tests** — in `worky-orchestrator.grpc-client.service.spec.ts`, REPLACE the first `runTask` test (lines 77-97, `'calls RunTask with snake_case fields …'`) with:

```ts
    it('calls RunTask with snake_case planner/executor fields and resolves the mapped response', async () => {
      mockGrpcClient.RunTask.mockImplementation((_req, _md, _opts, cb) =>
        cb(null, { session_id: 'sess-1', accepted: true, run_id: 'run-1' }),
      );

      const result = await service.runTask('user-1', 'sess-1', 'do the thing', {
        plannerModel: 'openai/gpt-4o',
        executorModel: 'anthropic/claude-sonnet-4-5',
        plannerPrompt: 'plan well',
        executorPrompt: 'execute well',
      });

      expect(result).toEqual({ sessionId: 'sess-1', accepted: true, runId: 'run-1' });
      const [req, md, opts] = mockGrpcClient.RunTask.mock.calls[0];
      expect(req).toMatchObject({
        user_id: 'user-1',
        session_id: 'sess-1',
        message: 'do the thing',
        planner_model: 'openai/gpt-4o',
        executor_model: 'anthropic/claude-sonnet-4-5',
        planner_prompt: 'plan well',
        executor_prompt: 'execute well',
      });
      expect(req).not.toHaveProperty('model');
      expect(md).toBeDefined();
      expect(opts).toHaveProperty('deadline');
    });
```

(The `'omits model/skills/connectors when not provided'` test at lines 99-112 stays valid — with empty `opts` the request is still exactly `{ user_id, session_id, message }` — leave it, but rename its title to `'omits planner/executor/skills/connectors when not provided'` for clarity.)

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `back/`): `npm test -- worky-orchestrator.grpc-client.service.spec.ts -t "snake_case planner/executor"`
Expected: FAIL — `req.planner_model` is undefined (client still sets `request.model`).

- [ ] **Step 3: Rewrite `runTask`'s opts type + request build** — in `worky-orchestrator.grpc-client.service.ts`, replace lines 158-175 (the signature's `opts` object type and the request-building block up to the `connectors` line) with:

```ts
  async runTask(
    userId: string,
    sessionId: string,
    message: string,
    opts: {
      plannerModel?: string;
      executorModel?: string;
      plannerPrompt?: string;
      executorPrompt?: string;
      skills?: unknown[];
      connectors?: unknown[];
    },
  ): Promise<{ sessionId: string; accepted: boolean; runId: string }> {
    const request: Record<string, unknown> = {
      user_id: userId,
      session_id: sessionId,
      message,
    };
    if (opts.plannerModel) request.planner_model = opts.plannerModel;
    if (opts.executorModel) request.executor_model = opts.executorModel;
    if (opts.plannerPrompt) request.planner_prompt = opts.plannerPrompt;
    if (opts.executorPrompt) request.executor_prompt = opts.executorPrompt;
    if (opts.skills?.length) request.skills = opts.skills;
    if (opts.connectors?.length) request.connectors = opts.connectors;
```

(Leave the rest of `runTask` — the `new Promise`/`this.client.RunTask(...)` block, lines 176-194 — unchanged.)

- [ ] **Step 4: Add `executorPrompt` to `deliverMailReply`** — in the same file, in `deliverMailReply`, update the input type (lines 258-264) to add `executorPrompt?: string;`:

```ts
  async deliverMailReply(input: {
    token: string;
    replyBody: string;
    replyFrom?: string;
    model?: string;
    executorPrompt?: string;
    connectors?: unknown[];
  }): Promise<{ delivered: boolean; sessionId: string; stepId: string }> {
```

and add `executor_prompt` to the payload object (after the `model:` line, line 271):

```ts
          model: input.model ?? '',
          executor_prompt: input.executorPrompt ?? '',
```

- [ ] **Step 5: Run the gRPC-client spec**

Run (from `back/`): `npm test -- worky-orchestrator.grpc-client.service.spec.ts`
Expected: PASS (both updated runTask tests + untouched ones).

- [ ] **Step 6: Ship the proto to `dist/`** — in `back/package.json`, the `postbuild` script is a single `node -e "…"` string. Immediately before the closing `\"` of that script (after the `conversation.proto` copy block that ends with `fs.copyFileSync(cv2ProtoSource,path.join(cv2ProtoTargetDir,'conversation.proto'));`), append this block (inside the same double-quoted `-e` string, so keep it as one line — no unescaped double quotes; use single quotes as the existing code does):

```
 const caProtoSource=path.join('src','modules','worky','proto','companion_ai.proto'); const caProtoTargetDir=path.join('dist','modules','worky','proto'); fs.mkdirSync(caProtoTargetDir,{recursive:true}); fs.copyFileSync(caProtoSource,path.join(caProtoTargetDir,'companion_ai.proto'));
```

- [ ] **Step 7: Verify the build copies the proto**

Run (from `back/`): `npm run build`
Then verify the file exists: `ls dist/modules/worky/proto/companion_ai.proto`
Expected: build succeeds and the file is listed.

- [ ] **Step 8: Commit**

```bash
git add back/src/modules/worky/services/worky-orchestrator.grpc-client.service.ts back/src/modules/worky/services/worky-orchestrator.grpc-client.service.spec.ts back/package.json
git commit -m "feat(worky): send planner/executor models + prompts over gRPC RunTask"
```

---

### Task 4: Read the stream settings and pass them on kickoff + resume

**Files:**
- Modify: `back/src/modules/worky/services/worky-stream.service.ts` (`ensureKickoffContext`, lines 165-182)
- Modify: `back/src/modules/worky/controllers/worky-message.controller.ts` (`sendMessage` lines 50-81; `resumeTurn` lines 150-172)
- Test: `back/src/modules/worky/services/worky-stream.service.spec.ts` (update `ensureKickoffContext` describe, lines 210-289)
- Test: `back/src/modules/worky/controllers/worky-message.controller.spec.ts` (update the runTask-forwarding tests, lines 56-132)

**Interfaces:**
- Consumes: `runTask` opts shape from Task 3; the four stream fields from Task 1.
- Produces: `ensureKickoffContext(streamId, userId)` now returns
  `{ aiSessionId: string; plannerModelId: string | null; executorModelId: string | null; plannerPrompt: string | null; executorPrompt: string | null }`.
  `sendMessage`/`resumeTurn` resolve both models via
  `turnContext.resolveManagerModel(...)` and forward
  `{ plannerModel, executorModel, plannerPrompt, executorPrompt, connectors }`.

**Design note:** per-turn model overrides (`dto.managerModelId`/`workerModelId` on
the message body) are dropped from the kickoff path — the persisted stream
settings are the single source of truth, and the frontend PromptBar no longer
sends per-turn model selection. The message DTO fields stay (harmless, unused).

- [ ] **Step 1: Update the `ensureKickoffContext` tests** — in `worky-stream.service.spec.ts`, in `describe('WorkyStreamService.ensureKickoffContext', …)`, update the two assertions:

Replace the existing lean-doc mock fields and the two `expect(res).toEqual(...)` lines so the mocked doc includes the new fields and the expectations match the new shape. Concretely, where the existing-session test mocks the doc (around line 255-263), make the mock return:

```ts
    streamModel.findById.mockReturnValue({
      lean: () => ({
        exec: async () => ({
          aiSessionId: 'sess-existing',
          plannerModelId: 'openai/gpt-4o',
          executorModelId: 'anthropic/claude-3-5-sonnet',
          plannerPrompt: 'plan',
          executorPrompt: 'exec',
        }),
      }),
    } as never);
```

and the expectation:

```ts
    expect(res).toEqual({
      aiSessionId: 'sess-existing',
      plannerModelId: 'openai/gpt-4o',
      executorModelId: 'anthropic/claude-3-5-sonnet',
      plannerPrompt: 'plan',
      executorPrompt: 'exec',
    });
```

For the "lazily creates a session" test (around line 268-278), mock the doc with `aiSessionId: null` and the four new fields `null`, and expect:

```ts
    expect(res).toEqual({
      aiSessionId: 'sess-new',
      plannerModelId: null,
      executorModelId: null,
      plannerPrompt: null,
      executorPrompt: null,
    });
```

> Match the exact mocking style already in this describe block (how it stubs `findById().lean().exec()` and `orchestrator.createSession`). Only the field set and expectations change.

- [ ] **Step 2: Run to verify failure**

Run (from `back/`): `npm test -- worky-stream.service.spec.ts -t "ensureKickoffContext"`
Expected: FAIL — returned object still has `managerModelId`, not the new fields.

- [ ] **Step 3: Update `ensureKickoffContext`** — in `worky-stream.service.ts`, replace the method body (lines 165-182). Change the return type, the lean generic, and the return object:

```ts
  async ensureKickoffContext(
    streamId: string,
    userId: string,
  ): Promise<{
    aiSessionId: string;
    plannerModelId: string | null;
    executorModelId: string | null;
    plannerPrompt: string | null;
    executorPrompt: string | null;
  }> {
    const doc = await this.streamModel
      .findById(streamId)
      .lean<{
        aiSessionId?: string | null;
        plannerModelId?: string | null;
        executorModelId?: string | null;
        plannerPrompt?: string | null;
        executorPrompt?: string | null;
      }>()
      .exec();
    if (!doc) {
      throw new NotFoundException(ErrorCode.WORKY_STREAM_NOT_FOUND, 'Worky stream not found.');
    }
    let aiSessionId = doc.aiSessionId ?? null;
    if (!aiSessionId) {
      aiSessionId = await this.orchestrator.createSession(userId);
      await this.streamModel.updateOne({ _id: streamId }, { $set: { aiSessionId } }).exec();
    }
    return {
      aiSessionId,
      plannerModelId: doc.plannerModelId ?? null,
      executorModelId: doc.executorModelId ?? null,
      plannerPrompt: doc.plannerPrompt ?? null,
      executorPrompt: doc.executorPrompt ?? null,
    };
  }
```

- [ ] **Step 4: Update the message-controller tests** — in `worky-message.controller.spec.ts`, update the mocks + assertions so `ensureKickoffContext` returns the new shape and `runTask` is asserted with the new opts.

Replace the `ensureKickoffContext.mockResolvedValue(...)` calls (lines 52, 65, 83-86, 96-99, 113) so each returns the new shape, e.g. the default:

```ts
    streamService.ensureKickoffContext.mockResolvedValue({
      aiSessionId: 'sess-xyz',
      plannerModelId: null,
      executorModelId: null,
      plannerPrompt: null,
      executorPrompt: null,
    });
```

Replace the "forwards the stream persistent managerModelId when set" test (lines 81-92) with a planner/executor version:

```ts
  it('forwards the stream persistent planner/executor models when set', async () => {
    planning.appendOwnerMessage.mockResolvedValue({ id: 'm1', content: 'hi', createdAt: 'now' });
    streamService.ensureKickoffContext.mockResolvedValue({
      aiSessionId: 'sess-xyz',
      plannerModelId: 'anthropic/claude-3-5-sonnet',
      executorModelId: 'openai/gpt-4o-mini',
      plannerPrompt: 'plan',
      executorPrompt: 'exec',
    });

    await controller.sendMessage(user, 'stream-1', { content: 'hi' } as never);

    expect(turnContext.resolveManagerModel).toHaveBeenCalledWith('anthropic/claude-3-5-sonnet');
    expect(turnContext.resolveManagerModel).toHaveBeenCalledWith('openai/gpt-4o-mini');
    const opts = orchestrator.runTask.mock.calls[0][3];
    expect(opts).toMatchObject({ plannerPrompt: 'plan', executorPrompt: 'exec' });
  });
```

Delete the now-obsolete "prefers the per-turn managerModelId override" test (lines 94-108) — per-turn override is intentionally removed. Update the resume test (lines ~120-132) so `findByIdInternal` returns `plannerModelId`/`executorModelId`/`plannerPrompt`/`executorPrompt` and assert `resolveManagerModel` is called with the planner + executor ids.

For `turnContext.resolveManagerModel` mock: keep it returning a resolved model, but since it's now called twice (planner + executor), either keep a single `mockResolvedValue('openai/gpt-4o-mini')` (both resolve the same) or use `mockImplementation((id) => Promise.resolve(id ?? 'openai/gpt-4o-mini'))`. Use the `mockImplementation` form so per-call assertions on the forwarded models are meaningful.

- [ ] **Step 5: Run to verify failure**

Run (from `back/`): `npm test -- worky-message.controller.spec.ts`
Expected: FAIL — controller still forwards `{ model, connectors }`.

- [ ] **Step 6: Rewrite `sendMessage`** — in `worky-message.controller.ts`, replace lines 50-81 (from `const saved =` through the `return`):

```ts
    const saved = await this.planning.appendOwnerMessage(user._id.toString(), streamId, dto);
    const ctx = await this.streamService.ensureKickoffContext(streamId, user._id.toString());
    // Persisted per-stream config is the single source of truth. Both models
    // resolve through the same chain (stream field → admin default); prompts
    // pass through raw (empty = server default).
    const [plannerModel, executorModel, connectors] = await Promise.all([
      this.turnContext.resolveManagerModel(ctx.plannerModelId),
      this.turnContext.resolveManagerModel(ctx.executorModelId),
      this.turnContext.resolveConnectors(user._id.toString()),
    ]);
    this.logger.log('[worky-orchestrator] RunTask kickoff', {
      streamId,
      aiSid: ctx.aiSessionId,
      plannerModel,
      executorModel,
      contentLength: dto.content?.length,
      connectorCount: connectors.length,
    });
    void this.orchestrator
      .runTask(user._id.toString(), ctx.aiSessionId, dto.content, {
        plannerModel,
        executorModel,
        plannerPrompt: ctx.plannerPrompt ?? undefined,
        executorPrompt: ctx.executorPrompt ?? undefined,
        connectors,
      })
      .catch((err) =>
        this.logger.error('[worky-orchestrator] RunTask kickoff failed', {
          streamId,
          error: (err as Error).message,
        }),
      );
    return { ...saved, turnStarted: true };
```

- [ ] **Step 7: Rewrite `resumeTurn`** — in `worky-message.controller.ts`, replace lines 154-171 (from `const stream =` through the `return`):

```ts
    const stream = await this.streamService.findByIdInternal(streamId);
    const aiSessionId = stream?.aiSessionId;
    if (!aiSessionId) return { resumed: false }; // nothing to resume

    const [plannerModel, executorModel, connectors] = await Promise.all([
      this.turnContext.resolveManagerModel(stream.plannerModelId ?? null),
      this.turnContext.resolveManagerModel(stream.executorModelId ?? null),
      this.turnContext.resolveConnectors(user._id.toString()),
    ]);
    void this.orchestrator
      .runTask(user._id.toString(), aiSessionId, '', {
        plannerModel,
        executorModel,
        plannerPrompt: stream.plannerPrompt ?? undefined,
        executorPrompt: stream.executorPrompt ?? undefined,
        connectors,
      })
      .catch((err) =>
        this.logger.error('[worky-orchestrator] resume RunTask failed', {
          streamId,
          error: (err as Error).message,
        }),
      );
    return { resumed: true };
```

- [ ] **Step 8: Run both specs to verify they pass**

Run (from `back/`): `npm test -- worky-message.controller.spec.ts`
Then: `npm test -- worky-stream.service.spec.ts`
Expected: PASS.

- [ ] **Step 9: Type-check the backend** (catches any missed reference to the removed `managerModelId` return field or `dto.managerModelId` usage)

Run (from `back/`): `npm run build`
Expected: compiles with no TypeScript errors.

- [ ] **Step 10: Commit**

```bash
git add back/src/modules/worky/services/worky-stream.service.ts back/src/modules/worky/services/worky-stream.service.spec.ts back/src/modules/worky/controllers/worky-message.controller.ts back/src/modules/worky/controllers/worky-message.controller.spec.ts
git commit -m "feat(worky): read per-stream planner/executor config on kickoff and resume"
```

---

### Task 5: Frontend — types, expanded settings card, i18n, and test

**Files:**
- Modify: `front/src/modules/worky/types.ts` (`WorkyStream` ~line 80; `UpdateWorkyStreamData` ~line 115)
- Modify: `front/src/modules/worky/components/StreamModelsControl.tsx` (full rewrite)
- Modify: `front/src/modules/worky/locales/en.json` (after line 91)
- Modify: `front/src/modules/worky/locales/fr.json` (matching keys)
- Create: `front/src/modules/worky/components/StreamModelsControl.test.tsx`

**Interfaces:**
- Consumes: the PATCH fields from Task 2 (`plannerModelId`, `executorModelId`,
  `plannerPrompt`, `executorPrompt`) and the response fields from Task 1.
- Produces: an "Agent configuration" card that reads/writes all four via
  `useUpdateStream` → PATCH `/worky/streams/{id}`.

- [ ] **Step 1: Write the failing component test** — create `front/src/modules/worky/components/StreamModelsControl.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { LocalizationProvider } from '@/modules/localization';
import { StreamModelsControl } from './StreamModelsControl';
import type { WorkyStream } from '../types';

const mutate = vi.fn();

vi.mock('../query/hooks', () => ({
  useUpdateStream: () => ({ mutate, isPending: false }),
}));

vi.mock('@/modules/models', () => ({
  useModels: () => [],
  useChefs: () => [],
  useModelsInitialized: () => true,
}));

const STREAM: WorkyStream = {
  id: 'stream-1',
  ownerUserId: 'u1',
  workspaceId: 'w1',
  artifactWorkspaceId: 'aw1',
  managerAgentId: 'a1',
  plannerModelId: null,
  executorModelId: null,
  plannerPrompt: null,
  executorPrompt: null,
  title: 'S',
  status: 'created' as never,
  controlState: 'active' as never,
  schedulerEnabled: false,
  currentPlanVersion: 0,
  budget: { limitUsd: 0, limitTokens: 0, spendUsd: 0, tokensUsed: 0, enforcement: 'hard_stop' },
  activeDurationMinutes: 0,
  createdAt: 'now',
  updatedAt: 'now',
  lastActivityAt: 'now',
};

function renderControl(stream: WorkyStream = STREAM) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <LocalizationProvider>
        <StreamModelsControl stream={stream} />
      </LocalizationProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => mutate.mockReset());

describe('StreamModelsControl', () => {
  it('renders the two prompt textareas', () => {
    renderControl();
    expect(screen.getByTestId('stream-planner-prompt')).toBeTruthy();
    expect(screen.getByTestId('stream-executor-prompt')).toBeTruthy();
  });

  it('persists the planner prompt on blur when it changed', () => {
    renderControl();
    const ta = screen.getByTestId('stream-planner-prompt');
    fireEvent.change(ta, { target: { value: 'Plan carefully' } });
    fireEvent.blur(ta);
    expect(mutate).toHaveBeenCalledWith({
      streamId: 'stream-1',
      data: { plannerPrompt: 'Plan carefully' },
    });
  });

  it('does not persist when the prompt is unchanged', () => {
    renderControl();
    fireEvent.blur(screen.getByTestId('stream-executor-prompt'));
    expect(mutate).not.toHaveBeenCalled();
  });

  it('clears the prompt to null when emptied', () => {
    renderControl({ ...STREAM, plannerPrompt: 'old' });
    const ta = screen.getByTestId('stream-planner-prompt');
    fireEvent.change(ta, { target: { value: '   ' } });
    fireEvent.blur(ta);
    expect(mutate).toHaveBeenCalledWith({
      streamId: 'stream-1',
      data: { plannerPrompt: null },
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run (from `front/`): `npm test -- StreamModelsControl.test.tsx`
Expected: FAIL — component has no `stream-planner-prompt` textarea yet.

- [ ] **Step 3: Add the frontend types** — in `types.ts`, in `WorkyStream` after `workerModelId?: string | null;` (line 80):

```ts
  /** Per-stream Planner model (LiteLLM id). `null` = admin default. Sent as `planner_model` over gRPC. */
  plannerModelId?: string | null;
  /** Per-stream Executor model (LiteLLM id). `null` = admin default. Sent as `executor_model`. */
  executorModelId?: string | null;
  /** Planner system-prompt override. `null`/empty = server default. */
  plannerPrompt?: string | null;
  /** Executor system-prompt override. `null`/empty = server default. */
  executorPrompt?: string | null;
```

and in `UpdateWorkyStreamData` after `workerModelId?: string | null;` (line 115):

```ts
  /** LiteLLM id for the Planner. `null` clears; omit = unchanged. */
  plannerModelId?: string | null;
  /** LiteLLM id for the Executor. `null` clears; omit = unchanged. */
  executorModelId?: string | null;
  /** Planner prompt override. `null`/empty clears; omit = unchanged. */
  plannerPrompt?: string | null;
  /** Executor prompt override. `null`/empty clears; omit = unchanged. */
  executorPrompt?: string | null;
```

- [ ] **Step 4: Rewrite `StreamModelsControl.tsx`** — replace the whole file with:

```tsx
import { useState } from 'react';
import { WorkyModelSelector } from './WorkyModelSelector';
import { useUpdateStream } from '../query/hooks';
import type { UpdateWorkyStreamData, WorkyStream } from '../types';
import { useModuleTranslation } from '@/modules/localization';

interface StreamModelsControlProps {
  stream: WorkyStream;
}

/**
 * Persistent per-stream agent configuration: Planner / Executor models and
 * system-prompt overrides. Rendered in the OrchestratorPanel Details tab.
 * Changes persist via PATCH `/worky/streams/{id}` and are sent to the worky
 * orchestrator on the next RunTask (`planner_model` / `executor_model` /
 * `planner_prompt` / `executor_prompt`).
 *
 * Model "Default" (the `null` pseudo-option) clears the persistent override so
 * the runtime falls back to the admin default. An empty prompt clears to the
 * server default.
 */
export function StreamModelsControl({ stream }: StreamModelsControlProps): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const updateStream = useUpdateStream();

  const [plannerPrompt, setPlannerPrompt] = useState(stream.plannerPrompt ?? '');
  const [executorPrompt, setExecutorPrompt] = useState(stream.executorPrompt ?? '');

  const patch = (data: UpdateWorkyStreamData) => {
    if (updateStream.isPending) return;
    updateStream.mutate({ streamId: stream.id, data });
  };

  const commitPrompt = (
    field: 'plannerPrompt' | 'executorPrompt',
    value: string,
    persisted: string | null | undefined,
  ) => {
    const next = value.trim() ? value : null;
    if (next === (persisted ?? null)) return;
    patch({ [field]: next });
  };

  return (
    <section
      data-testid='stream-models-control'
      className='rounded-md border border-border/60 bg-background/40 p-3 text-sm'
    >
      <header className='mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
        {t('stream.settings.title')}
      </header>
      <div className='flex flex-col gap-3'>
        <div className='flex flex-col gap-2'>
          <WorkyModelSelector
            value={stream.plannerModelId ?? null}
            label={t('stream.models.planner')}
            searchPlaceholder={t('promptBar.modelSelector.search')}
            defaultOptionLabel={t('promptBar.modelSelector.default')}
            emptyLabel={t('promptBar.modelSelector.empty')}
            disabled={updateStream.isPending}
            onChange={(next) => patch({ plannerModelId: next })}
          />
          <WorkyModelSelector
            value={stream.executorModelId ?? null}
            label={t('stream.models.executor')}
            searchPlaceholder={t('promptBar.modelSelector.search')}
            defaultOptionLabel={t('promptBar.modelSelector.default')}
            emptyLabel={t('promptBar.modelSelector.empty')}
            disabled={updateStream.isPending}
            onChange={(next) => patch({ executorModelId: next })}
          />
        </div>
        <label className='flex flex-col gap-1'>
          <span className='text-xs font-medium text-muted-foreground'>
            {t('stream.prompts.planner')}
          </span>
          <textarea
            data-testid='stream-planner-prompt'
            className='min-h-[72px] resize-y rounded-md border border-border/60 bg-background/60 p-2 text-xs'
            maxLength={40000}
            placeholder={t('stream.prompts.plannerPlaceholder')}
            value={plannerPrompt}
            onChange={(e) => setPlannerPrompt(e.target.value)}
            onBlur={() => commitPrompt('plannerPrompt', plannerPrompt, stream.plannerPrompt)}
          />
        </label>
        <label className='flex flex-col gap-1'>
          <span className='text-xs font-medium text-muted-foreground'>
            {t('stream.prompts.executor')}
          </span>
          <textarea
            data-testid='stream-executor-prompt'
            className='min-h-[72px] resize-y rounded-md border border-border/60 bg-background/60 p-2 text-xs'
            maxLength={40000}
            placeholder={t('stream.prompts.executorPlaceholder')}
            value={executorPrompt}
            onChange={(e) => setExecutorPrompt(e.target.value)}
            onBlur={() => commitPrompt('executorPrompt', executorPrompt, stream.executorPrompt)}
          />
        </label>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Add the i18n keys (en)** — in `front/src/modules/worky/locales/en.json`, after `"stream.models.workers": "Workers",` (line 91) add:

```json
  "stream.settings.title": "Agent configuration",
  "stream.models.planner": "Planner",
  "stream.models.executor": "Executor",
  "stream.prompts.planner": "Planner prompt",
  "stream.prompts.executor": "Executor prompt",
  "stream.prompts.plannerPlaceholder": "Leave empty to use the default planner prompt",
  "stream.prompts.executorPlaceholder": "Leave empty to use the default executor prompt",
```

- [ ] **Step 6: Add the i18n keys (fr)** — in `front/src/modules/worky/locales/fr.json`, after the matching `"stream.models.workers"` key add:

```json
  "stream.settings.title": "Configuration des agents",
  "stream.models.planner": "Planificateur",
  "stream.models.executor": "Exécuteur",
  "stream.prompts.planner": "Prompt du planificateur",
  "stream.prompts.executor": "Prompt de l'exécuteur",
  "stream.prompts.plannerPlaceholder": "Laissez vide pour utiliser le prompt de planification par défaut",
  "stream.prompts.executorPlaceholder": "Laissez vide pour utiliser le prompt d'exécution par défaut",
```

> Confirm both JSON files stay valid (trailing commas only between entries, none before the closing `}`). Insert before the next existing key, not at the end.

- [ ] **Step 7: Run the component test to verify it passes**

Run (from `front/`): `npm test -- StreamModelsControl.test.tsx`
Expected: PASS (all four cases).

- [ ] **Step 8: Type-check + lint the frontend**

Run (from `front/`): `npm run build` (or `npx tsc --noEmit` if the project exposes it)
Expected: no TypeScript errors (the new `WorkyStream` / `UpdateWorkyStreamData` fields resolve).

- [ ] **Step 9: Commit**

```bash
git add front/src/modules/worky/types.ts front/src/modules/worky/components/StreamModelsControl.tsx front/src/modules/worky/components/StreamModelsControl.test.tsx front/src/modules/worky/locales/en.json front/src/modules/worky/locales/fr.json
git commit -m "feat(worky): edit per-stream planner/executor models and prompts in Details tab"
```

---

## Verification (whole feature)

After all tasks:

- [ ] Backend: `npm test -- worky` (from `back/`) — all worky specs green.
- [ ] Backend: `npm run build` (from `back/`) — compiles; `dist/modules/worky/proto/companion_ai.proto` present.
- [ ] Frontend: `npm test -- worky` (from `front/`) — worky component tests green.
- [ ] Manual smoke (optional, needs a running orchestrator): open a stream → Details tab → set a Planner model, an Executor model, and both prompts → reload the page and confirm they persist → send a message → confirm the backend log line `[worky-orchestrator] RunTask kickoff` shows the resolved `plannerModel`/`executorModel`.

## Notes / known consequences

- Removing the Manager/Workers selectors from the card means `managerModelId` /
  `workerModelId` are no longer settable from the UI. They remain in the DB and
  keep driving the HTTP planning-turn path (Path B), which now always resolves
  to its admin default. This is the accepted "gRPC only" scope; a future cleanup
  can migrate Path B to the planner/executor fields and retire manager/worker.
- `DeliverMailReply` gains `executor_prompt` in the client payload, but the mail
  webhook/catchup callers do not have a stream in scope (the token→session map
  lives inside the orchestrator), so they send it empty (server default). Wiring
  a stream-specific executor prompt into the mail path is out of scope.
- The message-body DTO (`create-worky-message.dto.ts`) keeps its unused
  `managerModelId`/`workerModelId` fields; the kickoff path no longer reads them.
