# Conversation to Yellowmind Playbook Handoff Implementation Plan

> **Status:** Proposed architecture and implementation plan. No runtime code has been changed.
>
> **Execution:** Implement backend foundations before enabling the frontend action. Do not commit unless explicitly requested.

**Goal:** Let any authenticated user turn a completed conversation response into a reusable Playbook by handing the selected conversation path to Yellowmind, reviewing an editable prompt, completing Yellowmind clarification, and opening the generated draft through the existing Canvas handoff.

**Architecture:** Introduce a NestJS-owned, versioned, TTL-backed Conversation-to-Playbook handoff aggregate. The browser submits only source identifiers and branch-selection hints. NestJS resolves the canonical path, projects a bounded safe context, creates a dedicated Yellowmind conversation, and returns an opaque handoff ID plus a safe preview. The existing Yellowmind `start_playbook_generation` tool and Canvas `uiTarget` remain unchanged.

**Primary product decision:** Playbook creation is available to every authenticated user. Do not check, require, or gate this flow on `playbook.create` or another Playbook creation permission. Authentication and access to the source conversation and referenced resources remain mandatory because they protect source data, not Playbook creation.

---

## Confirmed Decisions

- Add **Create playbook with Yellowmind** to the AI response overflow menu.
- Show the action for completed, non-streaming AI responses when the existing Playbook MCP assistant feature is enabled.
- Do not use `playbook.create` to hide, disable, authorize, or reject this flow.
- Open a new dedicated `runtimePurpose: 'platform_copilot'` conversation for each accepted handoff.
- Do not submit automatically. Open Yellowmind with an editable suggested prompt and a read-only context preview.
- Resolve source context on the backend. Do not assemble trusted context in React or place full context in the prompt.
- Include visible execution summaries and reusable process evidence, never raw chain-of-thought.
- Use the existing Yellowmind clarification, draft construction, and Canvas handoff path.
- Keep the MCP tool schema, ADK contract, protobuf files, and SSE contracts unchanged.
- Reuse `VITE_PLAYBOOK_MCP_ASSISTANT_ENABLED` and `PLAYBOOK_MCP_ASSISTANT_ENABLED` as feature availability controls. Do not restore `VITE_PLAYBOOK_AGENT_ASSISTANT_ENABLED`.

---

## Authorization and Access Policy

### Playbook Creation

- Every authenticated user can prepare a handoff and generate a Playbook draft.
- No frontend permission check is allowed for `playbook.create`.
- No controller decorator, service assertion, MCP assertion, or generation-time check is allowed for `playbook.create`.
- Existing unrelated Playbook read, edit, execution, and administration authorization remains unchanged.

### Source Data

- The requester must be able to read the source conversation and selected messages.
- Every workspace, document, connector, agent, skill, citation, and artifact reference must be independently revalidated before inclusion.
- A missing or inaccessible reference is omitted without exposing whether a concealed resource exists.
- Group participants may create a Playbook when they can read the conversation. Participant identities and member-only metadata are never copied.
- Governed conversations require the existing governance policy to permit derivative use of their source context. If no authoritative decision exists, fail closed for that source conversation while still allowing the user to create Playbooks from ordinary conversations.
- These checks protect source information and do not constitute Playbook creation authorization.

---

## Current State

- `YellowStorm/front/src/modules/conversation/components/MessageActions.tsx` owns the response overflow menu. It currently exposes branch, disabled export, and report actions.
- `MessageActions.handleBranch()` already derives a selected branch prefix from `messages` and `activeBranches`, but frontend state can be incomplete because of pagination and hydration timing.
- `displayedVersion` is passed into `MessageActions` but is currently unused.
- `YellowStorm/front/src/modules/platform-copilot/platformCopilotPanelStore.ts` accepts only a pending prompt string.
- `PlatformCopilotMascot` consumes that string into the editable textarea.
- `usePlatformCopilotConversation` creates or reuses a `runtimePurpose: 'platform_copilot'` conversation and sends `content`, `requestId`, and untrusted UI `clientContext`.
- `ConversationAgentRequestBuilder` explicitly treats `clientContext` as a UI hint, not an authorization or trusted-resource source.
- Yellowmind can call `start_playbook_generation`, which binds generation to the trusted current Platform Copilot turn.
- `PlaybookAssistantService.startGeneration()` currently creates generated Playbooks with `workspaces: []`.
- Playbook MCP intentionally has no workspace or document search capability.
- Conversation messages contain useful plan, agent activity, tool activity, citation, artifact, agent, skill, workspace, and internal replay metadata.
- Existing authenticated message serialization is not safe for this handoff because it can retain `agentActivity.detail` and semantically unsafe tool data after generic redaction.

---

## Target User Flow

1. The user opens the overflow menu on a completed AI response.
2. The user selects **Create playbook with Yellowmind**.
3. The frontend calculates a branch-selection hint and calls the preparation endpoint with a stable creation request ID.
4. NestJS verifies authentication and source conversation access.
5. NestJS loads complete message history and resolves the canonical selected path through the target response.
6. NestJS resolves the selected original, corrected, abstention, or terminal correction-attempt answer.
7. NestJS projects a bounded allowlisted context and revalidates referenced resources.
8. NestJS creates or reuses an idempotent dedicated Yellowmind conversation and persists a 24-hour handoff record.
9. The frontend opens Yellowmind on that conversation with the safe preview and editable suggested prompt.
10. The user edits and explicitly sends the prompt.
11. The message request contains the opaque `playbookHandoffId`; it does not contain the projected context.
12. NestJS atomically binds the handoff to the authenticated actor, dedicated conversation, message request ID, and prompt hash.
13. Yellowmind calls the unchanged `start_playbook_generation` tool.
14. `PlaybookAssistantService` resolves the handoff from the trusted current user turn and copies context into the assistant request.
15. Existing assessment and clarification behavior runs.
16. Authorized and confirmed workspace defaults are revalidated immediately before draft creation.
17. Draft generation and construction run with the structured context supplied separately from the user prompt.
18. Yellowmind returns the existing `playbook.editor.assistant` Canvas handoff.

---

## Trust Boundaries

| Boundary | Trusted | Untrusted |
|---|---|---|
| Browser to NestJS | Authenticated session | Conversation ID, target message ID, branch map, fingerprints, answer version, handoff ID, edited prompt |
| Handoff preparation | Canonical server-loaded messages and access decisions | Frontend pagination and active branch state |
| Yellowmind turn | Server-bound actor, agent, conversation, correlation, and handoff reference | User-edited prompt and `clientContext` |
| MCP | Trusted actor envelope supplied outside model arguments | Any identity or resource identifier proposed by the model |
| Playbook generation | Server-loaded assistant request and handoff context | Model-proposed resource bindings |
| Canvas | Existing operation ownership, revision, and semantic `uiTarget` checks | Arbitrary URLs or browser automation instructions |

The frontend branch selection is an intent hint. NestJS must validate all relationships and calculate the authoritative canonical path.

---

## REST Contracts

### Prepare Handoff

`POST /api/v1/conversations/:conversationId/playbook-handoffs`

```ts
interface PrepareConversationPlaybookHandoffV1 {
  contractVersion: 1;
  targetMessageId: string;
  activeBranches: Record<string, string>;
  branchSelectionFingerprint: string;
  displayedAnswerVersion:
    | 'original'
    | 'corrected'
    | 'abstention'
    | `attempt:${string}`;
  creationRequestId: string;
}
```

`creationRequestId` is a UUID that remains stable across transport retries. The frontend resets it only after successful preparation or an explicit discard followed by a new attempt.

The branch fingerprint is lowercase SHA-256 over canonical JSON:

```ts
{
  contractVersion: 1,
  targetMessageId,
  displayedAnswerVersion,
  activeBranches: Object.entries(activeBranches)
    .sort(([left], [right]) => left.localeCompare(right)),
}
```

The fingerprint is integrity and idempotency evidence only. It does not authorize or prove branch relationships.

### Prepared Handoff Response

```ts
interface PreparedConversationPlaybookHandoffV1 {
  contractVersion: 1;
  status: 'prepared';
  handoffId: string;
  platformConversationId: string;
  suggestedPrompt: string;
  expiresAt: string;
  preview: ConversationPlaybookPreviewV1;
  provenance: {
    sourceConversationId: string;
    targetMessageId: string;
    displayedAnswerVersion: string;
    canonicalPathFingerprint: string;
    contextFingerprint: string;
  };
}
```

The response never includes full message history, hidden metadata, paths, URLs, tool payloads, or the persisted trusted context.

### Platform Copilot Message Extension

Extend the existing send-message payload and DTO:

```ts
interface PlatformCopilotHandoffMessageFields {
  playbookHandoffId?: string;
}
```

Rules:

- The field is valid only for `runtimePurpose: 'platform_copilot'` conversations.
- The handoff must belong to the authenticated user and the target dedicated conversation.
- The field participates in the message request fingerprint.
- Only the opaque reference is persisted in internal replay context.
- The reference is not returned in public message responses or SSE components.

---

## Persistence Contracts

### Conversation Playbook Handoff

Create a new `conversation_playbook_handoffs` collection:

```ts
interface ConversationPlaybookHandoffV1 {
  contractVersion: 1;
  handoffId: string;
  ownerId: string;
  sourceConversationId: string;
  targetMessageId: string;
  displayedAnswerVersion: string;

  creationRequestId: string;
  creationRequestFingerprint: string;
  clientBranchSelectionFingerprint: string;
  canonicalPathFingerprint: string;
  contextFingerprint: string;

  canonicalSelectedAnswerIds: string[];
  platformConversationId: string;

  context: TrustedConversationPlaybookContextV1;
  candidateBindings: {
    workspaceIds: string[];
    documentIds: string[];
    connectorIds: string[];
    agentIds: string[];
    skillIds: string[];
  };
  defaultWorkspaceIds: string[];

  status: 'prepared' | 'bound' | 'consumed';
  boundTurnRequestId?: string;
  boundPromptHash?: string;
  boundUserMessageId?: string;
  assistantRequestId?: string;

  preparedAt: Date;
  boundAt?: Date;
  consumedAt?: Date;
  expiresAt: Date;
}
```

Indexes:

- Unique `handoffId`.
- Unique `(ownerId, creationRequestId)`.
- Lookup `(ownerId, platformConversationId, status)`.
- TTL on `expiresAt`.

Logical expiry must be checked in services because MongoDB TTL deletion is asynchronous.

### Trusted Projected Context

```ts
interface TrustedConversationPlaybookContextV1 {
  contextVersion: 1;
  userGoal?: string;
  answerOutline?: string;
  outputFormatSummary?: string;
  executionSummaries: SafeExecutionSummary[];
  planSteps: SafePlanStep[];
  actions: SafeActionIdentity[];
  agents: SafeResourceReference[];
  skills: SafeResourceReference[];
  references: SafeResourceReference[];
  projection: {
    generatedAt: string;
    sourceMessageCount: number;
    includedMessageCount: number;
    omissions: Record<string, number>;
  };
}
```

Initial deterministic limits:

- Maximum 100 items per category.
- Maximum 500 characters per item.
- Maximum 32 KiB serialized context.
- Maximum nesting depth 6.
- Deterministic truncation with omission counts.

### Playbook Assistant Request

Add optional internal fields under the existing assistant request TTL:

```ts
handoffContext?: TrustedConversationPlaybookContextV1;
handoffProvenance?: {
  handoffId: string;
  handoffVersion: 1;
  sourceConversationId: string;
  targetMessageId: string;
  displayedAnswerVersion: string;
  canonicalPathFingerprint: string;
  contextFingerprint: string;
  acceptedAt: string;
};
workspaceDefaultIds: string[];
```

### Generated Playbook Provenance

Persist only compact provenance on the generated Flow:

```ts
generationProvenance?: {
  source: 'conversation_handoff';
  handoffVersion: 1;
  sourceConversationId: string;
  sourceTargetMessageId: string;
  displayedAnswerVersion: string;
  canonicalPathFingerprint: string;
  contextFingerprint: string;
  assistantRequestId: string;
  acceptedBy: string;
  acceptedAt: Date;
  confirmedWorkspaceIds: string[];
};
```

Do not persist source content, projected context, tool data, or prompts on the generated Playbook.

---

## Handoff State and Idempotency

```text
prepared -> bound -> consumed
```

### Preparation

- Reusing `creationRequestId` with the same request fingerprint returns the same handoff and dedicated conversation.
- Reusing it with different source, target, branch hint, or displayed version returns `ERR_1009`.
- Concurrent identical requests must converge through the unique index and reread path.

### Binding

- `prepared -> bound` is an atomic update filtered by owner, conversation, unexpired status, message request ID, and prompt hash.
- An exact send retry reuses the binding.
- Another prompt, actor, or conversation cannot reuse the handoff.
- Source conversation and canonical path access are revalidated at binding time.

### Consumption

- `bound -> consumed` is atomically tied to the deterministic assistant request and trusted current turn.
- Repeated MCP calls for the same turn reuse the consumed binding and assistant request.
- Context is copied into the assistant request before normal generation assessment proceeds.
- Consumption is not rolled back after generation failure; retries must remain tied to the same trusted context.

---

## Context Projection Policy

### Include

- Bounded user goal from selected user turns or trusted task summary.
- Bounded target-answer outline and output categories.
- `agentActivity.summary`, normalized status, and authorized actor label.
- Plan step labels and normalized statuses.
- Reusable task, queue, and checkpoint labels.
- Allowlisted tool or connector identity, display label, render kind, status, and safe summary.
- Active and visible agent and skill references.
- Authorized workspace, document, citation, and artifact references with safe labels.
- Output shape categories such as report, table, chart, document, structured data, or text.
- Deterministic omission counts.

### Always Exclude

- `agentActivity.detail` and hidden reasoning.
- Raw chain-of-thought, reasoning traces, or model scratchpads.
- `paramsJson`, `resultJson`, `primaryInput`, or raw connector results.
- Code, sandbox content, web preview content, commands, and repository paths.
- System prompts, developer prompts, prompt templates, and replay instructions.
- Secrets, credentials, cookies, tokens, connection strings, or signed parameters.
- Filesystem, object-storage, and workspace paths.
- URLs and download links.
- Citation excerpts and page content unless reduced to a safe non-sensitive label.
- Unknown component types and arbitrary component properties.

Reuse existing credential-redaction primitives as defense in depth, but admit fields only through the projector allowlist. A field does not become safe merely because generic sanitization changed its value.

---

## Canonical Branch and Answer Resolution

Extract canonical path resolution from `ConversationBranchService` into a reusable method used by both branch creation and handoff preparation.

The resolver must:

1. Load complete source history in chronological order.
2. Verify each submitted question ID belongs to a user message.
3. Verify each submitted answer is a completed AI child of that question.
4. Reject answers outside the path through the target response.
5. Force the target AI response as selected for its question.
6. Apply the same server defaults as existing branch creation when a selection is omitted.
7. Validate parent and reply relationships.
8. Return canonical selected messages and answer IDs.
9. Calculate a deterministic canonical path fingerprint.

The displayed answer resolver must support:

- Persisted original components.
- Persisted corrected components.
- Persisted abstention state.
- An exact terminal correction attempt containing components.

Reject streaming, incomplete, missing, stale, or non-terminal versions.

---

## Resource Revalidation

At preparation:

- Verify source conversation and target message access.
- Verify workspace read access and active state.
- Verify document existence, parent workspace access, and usable processing state.
- Verify connector active state and requester access without copying credentials.
- Verify agent and skill active state and requester visibility.
- Verify artifacts and citations belong to the selected messages and source conversation.

At handoff binding:

- Revalidate source conversation access and canonical path fingerprint.
- Omit newly inaccessible non-essential references.
- Return conflict when source changes would materially alter trusted context.

Before draft creation:

- Revalidate every confirmed workspace.
- Persist only currently accessible workspace IDs.
- Do not silently replace a revoked workspace with another resource.

Workspace default policy:

- One directly bound, accessible, unambiguous workspace may become a default.
- Multiple candidate workspaces require Yellowmind clarification.
- A workspace selected through an existing typed resource clarification becomes confirmed after server validation.
- A selected document may imply its accessible parent workspace after server validation.

---

## Suggested Prompt

The preparation service returns a localized prompt similar to:

```text
Create a reusable Playbook based on this conversation.

Generalize organization names, dates, reporting periods, and other one-off
values into inputs. Preserve useful workflow steps, resource requirements,
connector actions, agent responsibilities, validation checks, and output format.

Do not reproduce the answer as a fixed result. Build the process that could
produce an equivalent answer for new inputs.

Ask me to clarify ambiguous resource bindings or workflow decisions before
creating the draft.
```

Only this prompt is editable. The safe context preview is read-only and clearly identified as source context.

---

## Frontend Implementation

### Conversation Action

Modify `YellowStorm/front/src/modules/conversation/components/MessageActions.tsx`:

- Add a `Workflow` or `Sparkles` menu icon.
- Place **Create playbook with Yellowmind** after **Branch from here**.
- Show it when the response is complete, non-streaming, and the MCP assistant feature is enabled.
- Do not read user permissions for this action.
- Reuse branch-prefix derivation for the request hint.
- Include the selected displayed answer version.
- Hold one stable creation request ID across preparation retries.
- Disable only while preparation is in flight.
- Open Yellowmind only after successful preparation.

### API and Types

Modify:

- `YellowStorm/front/src/lib/api/config.ts`
- `YellowStorm/front/src/modules/conversation/api.ts`
- `YellowStorm/front/src/modules/conversation/types.ts`

Add the preparation endpoint, request/response contracts, preview types, and optional `playbookHandoffId` send field.

### Platform Copilot State

Modify `platformCopilotPanelStore.ts` to support a typed pending handoff draft separately from the existing simple prompt prefill:

```ts
interface PendingPlaybookHandoffDraft {
  handoffId: string;
  platformConversationId: string;
  suggestedPrompt: string;
  preview: ConversationPlaybookPreviewV1;
  expiresAt: string;
  messageRequestId: string;
}
```

- Keep the draft in memory only.
- Do not write preview or handoff contents to local storage, URLs, or navigation state.
- Clear after successful send or explicit discard.
- Preserve the draft after a send failure.

### Dedicated Conversation

Modify `usePlatformCopilotConversation.ts`:

- Activate the prepared `platformConversationId` instead of the stored general conversation.
- Hydrate it through existing conversation APIs.
- Attach `playbookHandoffId` only to the first explicit handoff send.
- Keep the same message request ID for exact retries.
- Clear pending handoff state only after successful message creation.
- Leave normal Platform Copilot conversation behavior unchanged.

### Yellowmind Preview

Modify `PlatformCopilotMascot.tsx`:

- Render a concise source-context card above the composer.
- Show source goal, process steps, action identities, resource labels, and omission warnings.
- Keep the context card read-only.
- Load and focus the editable suggested prompt.
- Provide explicit Send and Discard controls.
- Show expiration and re-prepare errors through `aria-live`.
- Preserve desktop panel and compact Sheet layouts.
- Do not submit on panel open.

### Internationalization

Add all labels to both languages:

- `conversation/locales/en.json`
- `conversation/locales/fr.json`
- `platform-copilot/locales/en.json`
- `platform-copilot/locales/fr.json`

No user-facing string may be hardcoded.

---

## Backend Conversation Implementation

### New Files

| File | Responsibility |
|---|---|
| `dto/prepare-playbook-handoff.dto.ts` | Validate the versioned preparation request |
| `interfaces/conversation-playbook-handoff.interface.ts` | Define request, preview, trusted context, binding, and provenance types |
| `schemas/conversation-playbook-handoff.schema.ts` | Persist handoff state, fingerprints, context, and TTL |
| `services/conversation-playbook-context-projector.service.ts` | Resolve displayed versions and build the strict allowlisted context |
| `services/conversation-playbook-context-projector.service.spec.ts` | Prove safe inclusion, exclusion, limits, and deterministic output |
| `services/conversation-playbook-handoff.service.ts` | Prepare, bind, consume, revalidate, and replay handoffs |
| `services/conversation-playbook-handoff.service.spec.ts` | Cover access, branch resolution, state transitions, expiry, and races |

### Existing Files

| File | Change |
|---|---|
| `services/conversation-branch.service.ts` | Extract reusable canonical path resolution |
| `services/conversation-branch.service.spec.ts` | Verify shared resolution preserves branch behavior |
| `controllers/conversation.controller.ts` | Add authenticated preparation endpoint and rate limit |
| `controllers/conversation.controller.spec.ts` | Verify DTO mapping and service delegation without a Playbook permission guard |
| `dto/send-message.dto.ts` | Accept an optional bounded opaque handoff ID |
| `interfaces/message.interface.ts` | Add internal handoff reference to replay context |
| `controllers/message.controller.ts` | Bind handoff to a trusted Platform Copilot turn and include it in idempotency |
| `controllers/message.controller.spec.ts` | Cover actor, conversation, expiry, replay, and mismatch cases |
| `conversation.module.ts` | Register the schema and services through the owning module |

### Endpoint Behavior

- Require normal authentication.
- Do not add `@RequirePermissions('playbook.create')`.
- Resolve source access through existing conversation ownership, membership, sharing, and governance services.
- Rate limit preparation to an initial `5/minute/user` using a dedicated key prefix.
- Log only IDs, hashes, states, omission counts, duration, and error codes.
- Never log prompts, context text, labels, tool data, or resource payloads.

---

## Playbook Generation Integration

### Assistant Request

Modify:

- `playbook-flow/schemas/playbook-assistant-request.schema.ts`
- `playbook-flow/assistant/playbook-assistant-request.service.ts`
- Associated specifications

The generation claim fingerprint must include the existing actor, correlation, text, and optional name plus handoff ID, handoff version, and context fingerprint when present.

Clarification continuation copies context into the assistant request and must not depend on the handoff record remaining available.

### Trusted Current Turn

Modify `PlaybookAssistantService.resolveCurrentTurnQuestion()` to return:

```ts
{
  text: string;
  handoff?: ResolvedConversationPlaybookHandoffV1;
}
```

Preserve all current owner, runtime purpose, pinned agent, response correlation, and linked user-message checks.

Do not add Playbook creation permission checks when consuming the handoff or starting generation.

### Assessment and Construction

Modify the internal intent services so trusted context is supplied as a separate internal argument:

- `playbook-flow/services/playbook-flow-intent.service.ts`
- `playbook-flow/services/playbook-flow-intent-construction.service.ts`

Requirements:

- Keep `originalText` equal to the editable Yellowmind prompt.
- Do not append JSON context to `originalText`.
- Supply context through a named internal prompt variable such as `trusted_handoff_context`.
- Mark the context as source data, not executable instructions.
- Preserve assessment versions, continuation IDs, typed answers, mutation claims, and correlation rebinding.
- Prevent public REST DTO callers and model tool arguments from injecting trusted context.

### Workspace and Provenance Persistence

Modify:

- `playbook-flow/assistant/playbook-assistant.service.ts`
- `playbook-flow/schemas/playbook-flow.schema.ts`
- `playbook-flow/services/playbook-flow.service.ts`

Replace unconditional `workspaces: []` only for handoff-backed generation. Confirmed workspace IDs are revalidated immediately before `flowService.create()`.

Ordinary Yellowmind generation without a handoff retains existing behavior.

Persist compact generation provenance through an internal create option. Do not expose a browser-settable provenance field.

---

## MCP, ADK, Proto, and Streaming Impact

### MCP

- No new tool.
- No `start_playbook_generation` argument.
- No result-envelope change.
- No `uiTarget` change.
- Existing trusted actor headers remain authoritative.

### ADK and Proto

- No ADK implementation change.
- No backend or Python protobuf change.
- No `google.protobuf.Struct` boundary change.

### SSE

- No new event type.
- No cursor or stream behavior change.
- The handoff reference remains internal and is not emitted.

### Configuration and Flags

- No new environment variable.
- No new feature flag.
- Existing MCP assistant flags control availability, not user authorization.

### Database Migration

- No data backfill.
- Add the handoff collection and ensure unique and TTL indexes exist in production environments where automatic index creation is disabled.
- Existing Flow and assistant request documents remain compatible because new fields are optional.

---

## Implementation Order

### Phase 1: Contracts and Canonical Resolution

1. Add versioned frontend and backend contract types.
2. Extract canonical branch resolution.
3. Add displayed answer version resolution.
4. Add deterministic fingerprints and tests.

### Phase 2: Safe Projector

5. Implement allowlisted component projection.
6. Add resource lookup and safe-label helpers through owning services.
7. Add hard category, text, depth, and total-size limits.
8. Add adversarial sanitization and prompt-injection tests.

### Phase 3: Handoff Aggregate

9. Add schema and indexes.
10. Implement preparation idempotency and duplicate-key recovery.
11. Implement source conversation and resource access checks.
12. Create the dedicated Platform Copilot conversation idempotently.
13. Implement bind and consume transitions.
14. Add the preparation controller route and rate limit.

### Phase 4: Frontend UX

15. Add the conversation menu action without permission gating.
16. Add API wrapper, endpoint registry, and types.
17. Extend panel state with a typed pending handoff.
18. Activate the dedicated Yellowmind conversation.
19. Render the preview, prompt, Send, Discard, expiry, and retry states.
20. Add EN/FR copy and accessibility behavior.

### Phase 5: Trusted Turn Binding

21. Add `playbookHandoffId` to the send DTO and frontend payload.
22. Bind it atomically to the exact Platform Copilot turn.
23. Store only an internal replay reference.
24. Ensure public serializers and SSE omit it.

### Phase 6: Generation Context

25. Resolve the handoff from the trusted current turn.
26. Copy context and provenance into the assistant request.
27. Include context fingerprints in assistant request idempotency.
28. Pass trusted context separately into assessment and construction.
29. Preserve existing clarification and retry semantics.

### Phase 7: Workspace and Provenance

30. Resolve unambiguous defaults and typed clarification choices.
31. Revalidate workspace access before draft creation.
32. Persist confirmed workspaces and compact provenance.
33. Verify ordinary non-handoff generation remains unchanged.

### Phase 8: Verification and Rollout

34. Run focused frontend and backend tests.
35. Run production builds.
36. Run MCP regression tests.
37. Complete browser QA on desktop and compact layouts.
38. Run the blocking reviewer gate.
39. Deploy backend first, then enable the frontend action under existing flags.
40. Update canonical Yellowmind and Playbook MCP memory after verified completion.

---

## Test Plan

### Frontend Unit and Component Tests

Modify or add:

- `conversation/components/MessageActions.test.tsx`
- `platform-copilot/platformCopilotPanelStore.test.ts`
- `platform-copilot/usePlatformCopilotConversation.test.tsx`
- `platform-copilot/PlatformCopilotMascot.test.tsx`

Cases:

- Action appears for any authenticated user without `playbook.create`.
- Action is hidden only when MCP assistant availability is off or response is incomplete/streaming.
- Preparation request contains the target, branch hint, displayed version, fingerprint, and stable request ID.
- No message is sent when the panel opens.
- The dedicated conversation is activated.
- The prompt is editable and preview is read-only.
- Successful send includes the opaque handoff ID once.
- Failed send preserves prompt, handoff, and request identity.
- Discard clears transient state.
- Expired handoff offers re-preparation.
- Keyboard and screen-reader behavior is correct.

Command from `YellowStorm/front`:

```powershell
npm test -- --run src/modules/conversation/components/MessageActions.test.tsx src/modules/platform-copilot/platformCopilotPanelStore.test.ts src/modules/platform-copilot/usePlatformCopilotConversation.test.tsx src/modules/platform-copilot/PlatformCopilotMascot.test.tsx
npm run build
```

### Backend Conversation Tests

Cases:

- Any authenticated source-conversation reader can prepare a handoff without Playbook permissions.
- Anonymous requests remain rejected by normal authentication.
- Canonical branch resolution works with incomplete frontend pagination.
- Invalid question-answer pairs and target versions are rejected.
- Original, corrected, abstention, and terminal attempts resolve correctly.
- Identical concurrent requests produce one handoff and conversation.
- Mismatched creation request reuse returns idempotency mismatch.
- Projector excludes reasoning detail, raw tool data, code, prompts, secrets, paths, and URLs.
- Inaccessible references are omitted without existence disclosure.
- Binding rejects wrong actor, wrong conversation, expired handoff, changed prompt identity, and stale source context.
- Public message responses and SSE do not expose the handoff reference.

Command from `YellowStorm/back`:

```powershell
npm test -- --runInBand src/modules/conversation/services/conversation-branch.service.spec.ts src/modules/conversation/services/conversation-playbook-context-projector.service.spec.ts src/modules/conversation/services/conversation-playbook-handoff.service.spec.ts src/modules/conversation/controllers/conversation.controller.spec.ts src/modules/conversation/controllers/message.controller.spec.ts
```

### Backend Playbook Tests

Cases:

- Trusted current turn resolves the exact handoff.
- The assistant request copies context before handoff expiry.
- Handoff context participates in idempotency.
- Clarification in a later turn retains context.
- Assessment and construction receive structured context separately from `originalText`.
- No `playbook.create` assertion runs for handoff-backed or ordinary generation.
- One unambiguous authorized workspace is persisted.
- Multiple workspace candidates require clarification.
- Revoked workspace access fails before Flow creation.
- Compact provenance is persisted and source content is not.
- Mutation retries do not create duplicate drafts.
- Ordinary generation remains compatible.

Command from `YellowStorm/back`:

```powershell
npm test -- --runInBand src/modules/playbook-flow/assistant/playbook-assistant.service.spec.ts src/modules/playbook-flow/assistant/playbook-assistant-request.service.spec.ts src/modules/playbook-flow/services/playbook-flow-intent.service.spec.ts src/modules/playbook-flow/services/playbook-flow-intent-construction.service.spec.ts src/modules/playbook-flow/services/playbook-flow.service.spec.ts
npm run build
```

### MCP Regression

Command from `mcp-playbook`:

```powershell
python -m pytest tests/test_server.py
```

This confirms that `start_playbook_generation` and the Canvas `uiTarget` remain unchanged.

### Browser QA

- Desktop panel and compact Sheet layouts.
- Mouse and keyboard menu activation.
- Focus moves to the editable prompt.
- Screen-reader labels for action, preview, expiration, Send, and Discard.
- Original, corrected, abstention, and terminal-attempt responses.
- Long and paginated conversations with alternate branches.
- Ordinary, group, and governed source conversations.
- User with no Playbook permissions can complete the full flow.
- Feature flag off, streaming response, expired handoff, network retry, and source access loss.
- No automatic `/messages` request occurs on menu selection.
- Browser storage, URLs, public message payloads, and SSE contain no projected context.

---

## Error Mapping

| Condition | HTTP behavior |
|---|---|
| Source conversation or message not visible | Existing 404 conversation/message error |
| Invalid branch, fingerprint, or answer version | Existing 400 bad-request or branch error |
| Source conversation/resource access denied | Existing 403 access error |
| Target incomplete or source materially changed | 409 conflict |
| Request or handoff identity reused with different content | `ERR_1009` |
| Handoff expired | `ERR_1008` / 410 |
| Preparation rate exceeded | `ERR_1007` / 429 |
| MCP assistant unavailable | Existing 503 service-unavailable error |

Do not add or use an error for missing Playbook creation permission.

---

## Observability

Emit structured metrics for:

- Preparation requested, succeeded, replayed, expired, or rejected.
- Projection omissions by category.
- Handoff bound and consumed.
- Canonical path stale conflicts.
- Source access rejection.
- Workspace default proposed, clarified, accepted, or revoked.
- Draft generation success or failure.

Log only actor ID, source conversation ID, target message ID, handoff ID, fingerprints, states, counts, duration, and error code.

Never log prompts, context text, answer content, resource labels, component payloads, credentials, or full request bodies.

Aggregate repeated omission events rather than logging each excluded field.

---

## Failure Recovery

- Preparation network failure: retry with the same creation request ID.
- Duplicate preparation: return the existing handoff and dedicated conversation.
- Message send failure: preserve the editable prompt and exact message request ID.
- Expired or stale handoff: preserve edited prompt locally and offer re-preparation with a new creation request ID.
- Generation failure: use existing assistant mutation reset and retry behavior.
- Workspace access loss: stop before Flow creation and ask for a fresh resource choice.
- Panel close before send: retain the in-memory draft until explicit discard, successful send, expiry, or page reload.
- Page reload before send: the full projected context remains server-side, but the initial version does not restore unsent handoff UI automatically.

---

## Rollout and Rollback

### Rollout

1. Deploy the backend schema, services, endpoint, send binding, and generation integration.
2. Verify unique and TTL indexes.
3. Run backend and MCP regression tests.
4. Deploy frontend code with the action controlled by the existing MCP assistant flag.
5. Run browser QA with users that have no Playbook permissions.
6. Monitor preparation, binding, consumption, omission, and generation metrics.

### Rollback

- Disable existing MCP assistant availability flags.
- The conversation action disappears and preparation returns unavailable.
- Existing ordinary conversations and generated Playbooks remain valid.
- Optional schema fields are ignored safely by older code.
- Keep the handoff collection and indexes until all 24-hour records expire.
- Do not delete generated Playbooks during rollback.

---

## Acceptance Criteria

1. Every authenticated user can see and use **Create playbook with Yellowmind** on an eligible response without `playbook.create`.
2. Backend preparation and generation do not assert a Playbook creation permission.
3. Source conversation and resource access remain server-enforced.
4. Menu selection prepares the handoff and opens Yellowmind without sending a message.
5. A fresh dedicated Platform Copilot conversation is used for the handoff.
6. The suggested prompt is editable and the context preview is read-only.
7. NestJS resolves complete canonical branch history independently of frontend pagination.
8. Invalid target relationships and displayed answer versions are rejected.
9. The handoff preview and trusted context contain no raw chain-of-thought, reasoning detail, tool inputs/results, code, prompts, secrets, paths, or URLs.
10. Safe process summaries, action identities, agents, skills, and references are retained.
11. Handoff preparation, binding, and consumption are idempotent and actor-bound.
12. The handoff cannot be used in another actor's or another Platform Copilot conversation.
13. The MCP tool contract and Canvas handoff remain unchanged.
14. Structured context reaches both assessment and construction without being copied into `originalText`.
15. Existing clarification and mutation retry behavior remains intact.
16. Only currently accessible and confirmed workspaces are persisted.
17. Generated Playbooks retain compact provenance but no copied source content.
18. Expired, stale, and revoked-resource cases fail safely and support recovery.
19. Existing non-handoff Yellowmind and Playbook generation behavior remains compatible.
20. Frontend tests, backend tests, builds, MCP regression, frontend QA, and reviewer gates pass.

---

## Non-Goals

- Using Playbook creation permissions for any part of this flow.
- Copying the source conversation into Yellowmind history.
- Sending raw conversation JSON to the browser, MCP server, or visible prompt.
- Adding workspace or document search to Playbook MCP.
- Changing MCP, ADK, protobuf, SSE, or Canvas handoff contracts.
- Automatically sending the Yellowmind prompt on menu selection.
- Automatically binding ambiguous connectors, agents, documents, or multiple workspaces.
- Persisting full source context on the generated Playbook.
- Building a general cross-product handoff framework in this change.
- Adding long-term compliance audit storage beyond compact Playbook provenance.

---

## Required Gates

- **Plan:** complete in this document.
- **Frontend QA:** required because the response menu and Yellowmind panel change.
- **Reviewer:** required because the implementation changes authorization assumptions, persistence, trusted-turn binding, sanitization, idempotency, and cross-module behavior.
- **Memory:** Full tier after implementation because the feature introduces a durable Conversation-to-Playbook contract, trust boundary, retention policy, and provenance invariant.
