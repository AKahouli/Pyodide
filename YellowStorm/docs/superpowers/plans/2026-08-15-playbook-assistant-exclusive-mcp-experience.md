# Playbook Assistant Exclusive MCP Experience Implementation Plan

> **Status:** Proposed architecture and implementation plan. No runtime code has been changed.
>
> **Execution:** Before coding, confirm whether implementation should run end-to-end without stopping or task-by-task with review between tasks. Do not commit unless explicitly requested.

**Goal:** Present one Yellowmind assistant identity across the global assistant and the Playbook Canvas while making Playbook MCP the exclusive semantic capability boundary for Playbook discovery, clarification, generation, modification, optimization, validation, and execution.

**Architecture:** Preserve two contextual surfaces backed by separate system-agent policies. The global assistant discovers, opens, validates, runs, diagnoses, and starts new Playbook drafts. The Canvas assistant clarifies and modifies the currently open Playbook. Both use only allowlisted Playbook MCP tools. The authenticated Canvas continues to own local unsaved state, ordered JWT SSE consumption, graph preview, undo/rollback, commit/apply/discard, navigation, and runtime HITL.

**Primary constraint:** "MCP-only" applies to semantic assistant capabilities. It does not move MCP credentials into the browser and does not replace native editor transport/control APIs.

---

## Executive Recommendation

- Preserve `PlaybookDesignerPanel` as the contextual Playbook surface. Do not replace it with the global assistant panel.
- Present both surfaces as one Yellowmind assistant identity, while keeping separate system-agent allowlists and instructions.
- Remove the Canvas assistant's direct semantic fallbacks after parity is proven: direct `POST /playbooks/:id/intent-design`, direct assistant use of `POST /playbooks/:id/intent-constructions`, direct `POST /playbooks/generate`, and legacy direct `POST /playbooks/:id/design`.
- Preserve Canvas-native save-before-turn, ordered JWT event consumption, local ReactFlow/Zustand delta application, one undo checkpoint, failure/cancel rollback, revision-safe commit, Advisor Apply/Discard, and native runtime HITL.
- Add typed MCP capabilities for structured clarification and draft-safe Playbook generation. Do not add a generic graph patch tool.
- Replace base64 image tool arguments with trusted, short-lived attachment references.
- Standardize every MCP result on one versioned success/error envelope before expanding the inventory.
- Repair the verified connector authentication mismatch before any migration rollout.

---

## Confirmed Product Decisions

- There is one user-visible assistant identity with multiple contextual surfaces.
- The global assistant is the cross-product entry point.
- The Canvas assistant is the detailed Playbook editing context.
- Existing-Playbook graph changes must be completed in the Canvas, not invisibly committed by the global assistant.
- New Playbook generation may start globally but must create a draft-safe operation and hand off to the Canvas.
- The global assistant may run a Playbook only through the existing native confirmation policy.
- The Canvas assistant must preserve today's text, image, clarification, update, optimization, stream, cancel, undo, history, and revert outcomes.
- Runtime HITL reply, approval, rejection, blocker disabling, and resume remain native Canvas capabilities and remain absent from MCP.
- Browsers never receive MCP ingress credentials, internal-service tokens, or trusted identity headers.
- NestJS remains authoritative for permissions, object access, revisions, validation, construction, persistence, and execution.

---

## Assumptions Requiring Confirmation During Implementation

- Separate system-agent slugs may remain while both are presented as one product assistant.
- The existing MongoDB and object-storage infrastructure may hold expiring assistant requests, conversation messages, and attachment metadata.
- Current image limits remain four files, 1.5 MB each, with PNG, JPEG, WebP, and GIF support.
- New assistant history is scoped by user, conversation, and Playbook. Existing design-message rows remain read-only during deprecation rather than being rewritten in bulk.
- `PlaybookIntentBar` remains a separate local suggestion UI and is not merged into the conversational assistant in this scope.
- `default` remains the normalized tenant until an authoritative multi-tenant mapping exists. Tenant identity must never come from model arguments.
- Legacy snapshot history receives one release of read-only compatibility by default. Deletion requires separate telemetry and retention approval.

---

## Current-State Inventory

### End-to-End Canvas Assistant Paths

| Flow | Current path | State ownership | MCP gap |
|---|---|---|---|
| Existing Playbook, text request | `PlaybookDesignerPanel` -> `PlaybookCanvasPage.handleSubmitIntentFromDesigner()` -> `POST /playbooks/:id/assistant/turns` when the agent flag is enabled | MCP agent creates an operation; Canvas streams, previews, and commits | Already MCP-backed, but response typing and continuity are weak |
| Existing Playbook, image request | Designer -> direct `intent-design` -> direct `intent-constructions` | Base64 images go directly to Nest intent services | MCP route is bypassed |
| Clarification | Direct `intent-design` returns questions; Canvas stores answers locally and appends them to text | No durable assessment/continuation binding | Missing structured MCP assessment and continuation |
| Existing Playbook construction fallback | Direct `intent-constructions` -> JWT SSE -> local delta application -> native commit | Canvas owns preview/rollback/commit | Semantic start bypasses MCP |
| New Playbook generation | Store `generatePlaybook()` -> direct `/playbooks/generate` -> gRPC generation -> immediate persisted flow | Backend persists generated graph, Canvas then marks layout dirty | No draft-safe MCP generation operation |
| Legacy AI redesign | Store `designPlaybook()` -> direct `/:id/design` -> gRPC -> immediate update | Backend mutates canonical graph and stores snapshots | Not MCP-backed and not revision-safe operation history |
| Advisor remediation | Native request starts durable operation; Canvas previews and explicitly applies/discards | Correct Canvas ownership | Keep semantics; normalize MCP handoff/results |
| Runtime HITL | `PlaybookDesignerPanel` interrupt mode and native APIs | Canvas/runtime-owned | Intentionally excluded from MCP |

### Key Source References

- `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx:1792-3089` applies construction graph deltas to local Canvas state.
- `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx:3091-3162` owns cancellation, undo checkpoint, rollback, and revision-safe commit.
- `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx:3270-3356` selects the MCP-agent path or direct fallback and stores design history.
- `YellowStorm/front/src/modules/playbook/components/PlaybookDesignerPanel.tsx:132-153` manually injects prior message history into each prompt.
- `YellowStorm/front/src/modules/playbook/components/PlaybookDesignerPanel.tsx:229-254,729-800` owns current image limits and base64 conversion.
- `YellowStorm/front/src/modules/playbook/components/PlaybookDesignerPanel.tsx:547-727` renders structured clarification questions and resource choices.
- `YellowStorm/front/src/modules/playbook/utils/playbook-intent-flow.ts:129-246` consumes construction SSE and handles rollback/commit.
- `YellowStorm/front/src/modules/playbook/utils/playbook-intent-flow.ts:272-332` implements direct assessment and construction fallback.
- `YellowStorm/front/src/modules/playbook/store.ts:1535-1553` implements direct new-Playbook generation.
- `YellowStorm/front/src/modules/playbook/store.ts:4464-4545` implements legacy design history and snapshot revert.
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent.service.ts:415-440` implements current structured design assessment.
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-design.service.ts:48-150` implements direct generation and legacy redesign.
- `YellowStorm/back/src/modules/playbook-flow/assistant/playbook-assistant.service.ts:47-85` invokes the dedicated MCP-backed system agent and enforces one construction per turn.
- `YellowStorm/back/src/modules/playbook-flow/assistant/playbook-assistant-operation.service.ts:235-377` implements revision-safe commit/revert and generated-copy handling.
- `mcp-playbook/server.py:96-359` declares the current 26 tools.

### Current Playbook MCP Inventory

| Group | Tools | Current global access | Current contextual access |
|---|---|---|---|
| Discovery/context | `search_playbooks`, `open_playbook_context`, `get_playbook_summary`, `get_task_details`, `get_task_dependencies`, `validate_playbook` | Yes | Yes |
| Construction | `start_playbook_construction`, `get_playbook_construction`, `cancel_playbook_construction`, `revert_playbook_construction` | No | Yes |
| Optimization | `analyze_task_optimization`, `analyze_workflow_optimization`, `start_workflow_optimization`, `start_advisor_remediation_construction` | No | Yes |
| Playbook lifecycle | `create_playbook`, `clone_playbook` | No | Yes |
| Execution | `start_playbook_execution`, `list_playbook_executions`, `list_recent_executions`, `get_playbook_execution`, `get_execution_diagnostics`, `cancel_playbook_execution`, `trace_replay_playbook_execution`, `reexecute_playbook_execution`, `run_playbook_from_step`, `delete_playbook_execution` | Start, recent, get, and diagnostics only | All attached today |

### Verified Gaps and Defects

1. `PlaybookAssistantConnectorReconcilerService` and `ConnectorAuthService` send `X-Playbook-MCP-Token`, while `mcp-playbook/auth.py` explicitly rejects that header and requires bearer authentication.
2. MCP tool outputs are `dict[str, Any]`; connector action `outputSchema` values are `{}`.
3. `call()` and `mascot_call()` return different success/error shapes.
4. Most MCP calls require only a user ID, while confirmation policy requires a full tenant/user/agent/conversation/correlation actor envelope.
5. No MCP tool exposes the current structured design assessment or clarification continuation.
6. No MCP tool generates a complete new Playbook from natural language as one owned, idempotent operation.
7. Images force a direct semantic fallback and currently travel as base64 request content.
8. Contextual assistant turns do not preserve a server-owned conversation ID; the frontend manually injects history.
9. Legacy history revert stores graph snapshots and can bypass the newer assistant-operation revision model.
10. The contextual agent has a broad execution mutation inventory that is not required for Canvas design parity.

---

## Target Responsibility Model

| Capability | Global assistant | Contextual Canvas assistant | Canvas-native plumbing | Excluded |
|---|---|---|---|---|
| Search/discover | Owns | Optional | Renders targets | - |
| Open/read context | Owns | Owns current Playbook | Saves dirty state first | - |
| Explain/validate | Owns | Owns | Highlights diagnostics | - |
| New Playbook generation | Starts draft operation and handoff | May start from a new-draft Canvas context | Streams preview and commits | Model-chained create then construct |
| Existing graph update | Returns Canvas handoff | Assesses and starts one construction | Applies deltas, undo, rollback, commit | Invisible global commit |
| Clarification | May clarify generation | Owns detailed clarification | Renders current question/resource UI | Unbound free-text continuation |
| Images | No new global image UI required initially | Uses trusted references | Selects, uploads, removes | Base64 MCP arguments |
| Optimization | Diagnoses or hands off | Analyzes and starts construction | Preview/highlight | Generic patch |
| Advisor remediation | Handoff only | Starts preview | Explicit Apply/Discard | MCP Apply/Discard |
| Execution start | Owns after confirmation | Not needed for design parity | Shows status | Text-only confirmation |
| Construction status/cancel/revert | Reads/handoff only | Owns | JWT control and UI | MCP credentials in browser |
| History | Cross-task conversation | Per-Playbook conversation | Renders messages | Manual prompt concatenation |
| Runtime HITL | Status/navigation only | Status/navigation only | Fully owns responses | MCP HITL tools |

---

## Target Request Flows

### Contextual Existing-Playbook Change

1. Canvas saves dirty local state and obtains the canonical definition revision.
2. Canvas creates an assistant request containing text, conversation ID, revision, selection, execution context, and confirmed attachment IDs.
3. Nest persists a short-lived request binding and invokes the contextual system agent with trusted request identifiers.
4. The agent opens context through MCP and calls `assess_playbook_request`.
5. If clarification is required, Nest returns a typed clarification result and Canvas renders the current question UI.
6. Canvas submits typed answers against the continuation ID.
7. The agent starts at most one `start_playbook_construction` operation.
8. Canvas consumes the existing JWT SSE stream, previews deltas, and commits or rolls back using existing editor mechanics.

### Global New-Playbook Generation

1. The global assistant gathers the minimum goal and optional name/workspaces.
2. It calls `start_playbook_generation` once with a bound request ID.
3. Nest atomically claims an idempotent generation operation, creates an operation-owned draft shell, and starts construction.
4. MCP returns the draft Playbook ID, operation ID, base revision, and an allowlisted Canvas target.
5. The global assistant presents `Open in Canvas` rather than claiming a published result.
6. Canvas resumes the operation through JWT SSE and preserves normal preview/undo/commit behavior.
7. Failure or cancellation compensates only when the draft is still operation-owned and unchanged by the user.

---

## Proposed MCP Contracts

### Common Result Envelope

Every tool returns `PlaybookMcpResultV1<T>`.

```json
{
  "schemaVersion": "playbook.mcp.v1",
  "ok": true,
  "data": {},
  "meta": {
    "correlationId": "...",
    "entity": { "type": "playbook", "id": "..." },
    "playbookId": "...",
    "operationId": "...",
    "uiTarget": {
      "surface": "playbook.editor.assistant",
      "params": { "playbookId": "...", "operationId": "..." }
    }
  }
}
```

```json
{
  "schemaVersion": "playbook.mcp.v1",
  "ok": false,
  "error": {
    "code": "PLAYBOOK_ASSISTANT_STALE_REVISION",
    "message": "The Playbook changed after clarification began.",
    "retryable": false,
    "category": "conflict",
    "details": []
  },
  "meta": { "correlationId": "...", "playbookId": "..." }
}
```

Allowed error categories are `validation`, `authorization`, `conflict`, `not_found`, `rate_limit`, `dependency`, and `internal`.

### New and Changed Tools

| Tool | Inputs | Output | Side effect | Confirmation | Allowlist |
|---|---|---|---|---|---|
| `assess_playbook_request` | `request_id` | Assessment union with `assessmentId`, `continuationId`, revision, questions, choices, resource selectors, brief, assumptions, and risks | Persists assessment binding only | None | Global generation and contextual |
| `continue_playbook_clarification` | `continuation_id`, typed `answers[]` | Updated assessment union | Persists bound answers and reassesses | None | Global generation and contextual |
| `start_playbook_construction` | `request_id` or `continuation_id`, `context_id` | Operation ID, Playbook ID, base revision, status, Canvas target | Starts one durable operation | None; Canvas commit remains explicit editor plumbing | Contextual |
| `start_playbook_generation` | `request_id`, optional `name` | Draft Playbook ID, operation ID, base revision, status, Canvas target | Creates one operation-owned draft and starts construction | None; result is a draft | Global and contextual new-draft flow |
| `get_playbook_construction` | Existing IDs | Typed status, disposition, sequence, revision | None | None | Contextual |
| `cancel_playbook_construction` | Existing IDs and reason | Typed cancellation/compensation result | Cancels operation and may compensate draft | None | Contextual |
| `revert_playbook_construction` | Existing IDs | New revision or safe generated-draft deletion | Revision-safe mutation | Native acknowledgement where presented | Contextual |

### Final Global Allowlist

- `search_playbooks`
- `open_playbook_context`
- `get_playbook_summary`
- `get_task_details`
- `get_task_dependencies`
- `validate_playbook`
- `assess_playbook_request`
- `continue_playbook_clarification`
- `start_playbook_generation`
- `start_playbook_execution`
- `list_recent_executions`
- `get_playbook_execution`
- `get_execution_diagnostics`

The global assistant must not receive `start_playbook_construction` for an existing Playbook.

### Final Contextual Allowlist

- `open_playbook_context`
- `get_playbook_summary`
- `get_task_details`
- `get_task_dependencies`
- `validate_playbook`
- `assess_playbook_request`
- `continue_playbook_clarification`
- `start_playbook_construction`
- `start_playbook_generation`
- `get_playbook_construction`
- `cancel_playbook_construction`
- `revert_playbook_construction`
- `analyze_task_optimization`
- `analyze_workflow_optimization`
- `start_workflow_optimization`
- `start_advisor_remediation_construction`
- execution read tools only where current contextual UI behavior requires them

Remove `create_playbook` from assistant policies after generation is available. Keep `clone_playbook` only for an explicitly approved non-assistant consumer or a later confirmed product flow.

### Permanently Excluded

- Generic JSON or graph patch tools.
- MCP Apply/Discard tools.
- Runtime HITL reply, approve, reject, disable, or resume tools.
- Browser navigation or DOM automation tools.
- Attachment byte upload/download tools.
- Tool arguments containing tenant, user, agent, or other trusted identity.

---

## Cross-Boundary Contracts

### Request and Clarification Binding

Persist the following for each short-lived assistant request:

- request ID and idempotency key,
- operation kind: `inspect`, `existing_construction`, or `generation`,
- tenant, user, agent, conversation, and correlation IDs,
- optional Playbook ID and canonical definition revision for existing-Playbook requests,
- original request text,
- selected task and execution IDs,
- confirmed attachment IDs,
- assessment and continuation IDs,
- normalized typed answers,
- status and expiry.

Assessment returns one discriminated status:

- `needs_clarification`,
- `ready_for_review`,
- `ready_to_construct`.

Clarification questions preserve current fields: `id`, `question`, `reason`, `category`, `required`, `choices`, and `resourceSelector`.

Answers use structured values:

```ts
type PlaybookClarificationAnswer = {
  questionId: string;
  choice?: string;
  text?: string;
  resource?: { kind: 'workspace' | 'document'; id: string };
};
```

Nest resolves resource names, paths, workspace ownership, and MIME metadata. The frontend must stop serializing trusted resource metadata into free text.

Continuation rejects expired or mismatched user, tenant, conversation, Playbook, revision, request, or attachment bindings.

Generation assessment is bound to `operationKind=generation` before a Playbook exists. It has no Playbook/revision binding until `start_playbook_generation` atomically creates and records the draft shell. Contextual assessment always requires an existing Playbook and canonical revision.

### Trusted Image References

1. Canvas creates up to four scoped attachment upload intents through JWT.
2. Backend records owner, request, Playbook, expected revision, MIME, maximum size, correlation, and expiry.
3. Browser uploads directly to existing object storage using a short-lived presigned request.
4. Canvas confirms upload; backend verifies object existence, actual size, and allowed MIME.
5. Assistant turns reference opaque attachment IDs only.
6. Assessment/construction resolve bytes server-side and reuse current multimodal intent behavior.
7. Attachment IDs cannot cross user, conversation, request, Playbook, revision, or expiry boundaries.
8. Terminal operation cleanup and TTL cleanup delete transient objects idempotently.

Never place base64 data, signed URLs, object credentials, or attachment bytes in MCP arguments, tool output, prompts, or logs.

### Generation Safety

- Generation uniqueness is `(ownerId, requestId, operationKind)`.
- Duplicate starts return the original operation.
- The backend, not the model, owns draft-shell creation and construction start.
- The operation records `createdPlaybookId` and the shell's base revision.
- Failure/cancellation deletes the shell only when ownership and revision prove that no later user edit exists.
- Unsafe compensation preserves the draft and returns a conflict rather than deleting user work.
- Revert uses the same no-later-revision rule.

### Identity and Authentication

Connector ingress uses exactly:

- `Authorization: Bearer <PLAYBOOK_MCP_INGRESS_TOKEN>`,
- `X-YellowStorm-Tenant-Id`,
- `X-YellowStorm-User-Id`,
- `X-YellowStorm-Agent-Id`,
- `X-YellowStorm-Conversation-Id`,
- `X-Correlation-Id`.

Bearer-only inspection may enumerate tools. Every user-scoped invocation requires the full actor envelope. MCP forwards the full envelope plus `X-Internal-Token` to Nest. Nest still enforces permissions and entity access.

`X-Playbook-MCP-Token` must not be sent or accepted.

### Idempotency and Revision

- Assistant turn: stable request ID returned to the client.
- Assessment continuation: idempotent for request ID plus normalized answer set.
- Construction: one mutation-start operation per request/continuation.
- Generation: one operation per request and operation kind.
- Commit/apply: preserve existing `clientMutationId`, `assistantOperationId`, and expected-revision checks.
- A stale revision requires a reload/save and a new assistant request; it is not blindly retried.

### UI Targets

Allow only semantic targets resolved locally by the frontend:

- `playbook.list`
- `playbook.editor`
- `playbook.editor.assistant`
- `playbook.validation`
- `playbook.execution.details`
- `playbook.execution.task`

MCP must not return arbitrary authoritative URLs. The frontend constructs routes and preserves unsaved-change guards.

---

## Implementation Tasks

### Task 1: Freeze the MCP contract and repair authentication

**Modify or add:**

- `mcp-playbook/contracts.py`
- `mcp-playbook/server.py`
- `mcp-playbook/clients/yellowstorm_playbook_client.py`
- `mcp-playbook/auth.py`
- `mcp-playbook/tests/test_server.py`
- `mcp-playbook/tests/test_auth.py`
- `mcp-playbook/tests/test_backend_client.py`
- `YellowStorm/back/src/modules/connector/connector-auth.service.ts`
- `YellowStorm/back/src/modules/connector/connector.service.ts`
- `YellowStorm/back/src/modules/agent/services/playbook-assistant-connector-reconciler.service.ts`
- matching connector/reconciler specs

**Implement:**

- Add typed `playbook.mcp.v1` input/output models without adding a new framework.
- Replace the two error shapes with one envelope.
- Change server-config auth to bearer.
- Require and forward the complete dynamic actor envelope for runtime calls.
- Keep health checks public and tool inspection bearer-authenticated.
- Populate connector `outputSchema` instead of `{}`.
- Keep all JSON-schema enums string-only for Google ADK compatibility.
- Atomically update expected tool inventories and reconciliation tests.

**Acceptance:**

- Live authenticated MCP inspection succeeds with bearer auth.
- User-scoped calls fail when any required actor identity is absent.
- No code path sends `X-Playbook-MCP-Token`.
- Existing tools return one versioned envelope.

**Verification:**

- `cd mcp-playbook && python -m pytest tests/test_auth.py tests/test_backend_client.py tests/test_server.py -q`
- Focused backend connector and reconciler Jest specs.

### Task 2: Add durable assistant requests, conversations, and history

**Add or modify:**

- `back/src/modules/playbook-flow/schemas/playbook-assistant-request.schema.ts`
- `back/src/modules/playbook-flow/schemas/playbook-assistant-message.schema.ts`
- `back/src/modules/playbook-flow/assistant/playbook-assistant-request.service.ts`
- `back/src/modules/playbook-flow/assistant/playbook-assistant-history.service.ts`
- `back/src/modules/playbook-flow/assistant/playbook-assistant-context.service.ts`
- `back/src/modules/playbook-flow/assistant/playbook-assistant.service.ts`
- `back/src/modules/playbook-flow/dto/playbook-assistant.dto.ts`
- `back/src/modules/playbook-flow/playbook-flow.module.ts`
- `back/src/modules/agent/services/agent-task-execution.service.ts`
- focused specs

**Implement:**

- Persist request bindings, continuation identity, conversation identity, idempotency, and TTL.
- Return/reuse a contextual conversation ID as the global assistant already does.
- Pass trusted tenant/conversation/correlation context through agent execution.
- Persist user and assistant messages server-side.
- Stop relying on frontend prompt-history concatenation after rollout.
- Bind `contextId` to the request instead of using an untracked random ID.
- Provide a read-only adapter for legacy design messages.

**Acceptance:**

- A second Canvas turn reuses the same conversation without frontend-injected history.
- Cross-user, expired, replayed-with-different-content, and stale request bindings fail deterministically.
- New message history contains no graph snapshots.

### Task 3: Move structured clarification behind MCP

**Modify:**

- `mcp-playbook/server.py` and contracts/tests
- `back/src/modules/playbook-flow/controllers/playbook-assistant-internal.controller.ts`
- `back/src/modules/playbook-flow/services/playbook-flow-intent.service.ts`
- `back/src/modules/playbook-flow/assistant/playbook-assistant.service.ts`
- `back/src/modules/playbook-flow/dto/playbook-assistant.dto.ts`
- `front/src/modules/playbook/types.ts`
- `front/src/modules/playbook/api.ts`
- `front/src/modules/playbook/components/PlaybookDesignerPanel.tsx`
- `front/src/modules/playbook/components/PlaybookCanvasPage.tsx`
- `front/src/modules/playbook/utils/playbook-intent-flow.ts`
- focused tests

**Implement:**

- Add `assess_playbook_request` and `continue_playbook_clarification`.
- Reuse `PlaybookFlowIntentService.assessDesign()` internally.
- Authorize global use only for requests bound to `operationKind=generation`; contextual use requires an existing Playbook/revision binding.
- Return typed clarification questions and an authorized continuation ID.
- Submit typed answers and resource IDs.
- Reject stale revision and binding mismatches before construction.
- Preserve current Back, Continue, Skip, choice, custom-answer, and resource-picker UX.
- Render the same typed assessment in the global assistant for generation clarification, using a smaller question card when no resource picker is required.
- Disable direct Canvas `intent-design` calls under the rollout flag.

**Acceptance:**

- Ambiguous requests render the same clarification experience through MCP.
- Resource metadata is resolved server-side, not embedded in free text.
- A stale clarification cannot modify a newer Playbook revision.

**Verification:**

- Focused MCP and backend assessment/continuation tests.
- `npm test -- PlaybookDesignerPanel.test.tsx playbook-intent-flow.test.tsx`
- Browser test for multi-question and workspace/document clarification.

### Task 4: Add trusted attachment references

**Add or modify:**

- `back/src/modules/playbook-flow/schemas/playbook-assistant-attachment.schema.ts`
- `back/src/modules/playbook-flow/assistant/playbook-assistant-attachment.service.ts`
- JWT attachment DTOs/controllers
- existing storage service integration
- `back/src/modules/playbook-flow/services/playbook-flow-intent.service.ts`
- `front/src/modules/playbook/api.ts`
- `front/src/modules/playbook/types.ts`
- `front/src/modules/playbook/components/PlaybookDesignerPanel.tsx`
- `front/src/modules/playbook/components/PlaybookCanvasPage.tsx`
- focused tests

**Implement:**

- Add upload-init and upload-confirm contracts using existing object storage.
- Enforce current count, size, MIME, ownership, and expiry limits.
- Send attachment IDs in assistant turns.
- Resolve trusted bytes server-side for assessment and construction.
- Bind attachments to request, revision, conversation, and operation.
- Add terminal and TTL cleanup.
- Remove the `images => direct fallback` routing rule.

**Acceptance:**

- Current image-assisted generation works through MCP.
- No base64 or signed URL enters MCP arguments or logs.
- Cross-user, unconfirmed, oversized, unsupported, and expired attachments are rejected.

### Task 5: Add draft-safe Playbook generation

**Modify:**

- MCP contracts/server/tests
- `back/src/modules/playbook-flow/schemas/playbook-assistant-operation.schema.ts`
- `back/src/modules/playbook-flow/assistant/playbook-assistant-operation.service.ts`
- `back/src/modules/playbook-flow/assistant/playbook-assistant.service.ts`
- `back/src/modules/playbook-flow/services/playbook-flow-intent-construction.service.ts`
- internal controller and DTOs
- global/contextual connector allowlists
- `yellowstorm-adk/src/guardrails/mascot_tool_policy.py`
- `yellowstorm-adk/tests/test_mascot_tool_policy.py`
- `front/src/modules/second-brain/types.ts`
- `front/src/modules/second-brain/action-bus.ts`
- `front/src/modules/second-brain/SecondBrainMascot.tsx`
- relevant tests

**Implement:**

- Add `start_playbook_generation`.
- Claim an idempotent generation operation before creating the draft shell.
- Record operation ownership and base revision.
- Reuse the existing construction event pipeline.
- Return a typed Canvas assistant target.
- Compensate failed/cancelled drafts only when revision-safe.
- Preserve revision-safe generated-draft revert.
- Allow generation globally while continuing to deny existing-Playbook construction globally.
- Remove assistant reliance on `create_playbook` after parity.

**Acceptance:**

- Duplicate generation requests return one draft and one operation.
- Failure does not leave an unowned empty Playbook.
- User edits prevent unsafe compensation.
- Global generation hands off to Canvas and never claims publication.

### Task 6: Make the contextual Canvas assistant MCP-only

**Modify:**

- `front/src/modules/playbook/components/PlaybookCanvasPage.tsx`
- `front/src/modules/playbook/components/PlaybookDesignerPanel.tsx`
- `front/src/modules/playbook/utils/playbook-intent-flow.ts`
- `front/src/modules/playbook/api.ts`
- `front/src/modules/playbook/features.ts`
- backend assistant turn response contracts
- contextual system-agent instruction and allowlist
- focused tests

**Implement:**

- Route every contextual text/image/clarification turn through the dedicated agent and Playbook MCP.
- Require context open/assessment before mutation.
- Enforce at most one construction/generation operation per turn.
- Preserve current JWT SSE, local delta application, undo, rollback, cancel, and commit code.
- Preserve Advisor explicit Apply/Discard.
- Map the common MCP error envelope to localized existing UI states.
- Persist history from assistant turns instead of frontend `appendDesignMessage()` calls.
- Narrow contextual execution mutation tools to what is required for current UX.

**Acceptance:**

- With migration enabled, no Canvas assistant request calls direct `intent-design`, direct semantic construction start, `/playbooks/generate`, or `/:id/design`.
- Text, image, clarification, existing update, optimization, cancellation, rollback, commit, and revert maintain parity.
- Native stream/control/commit traffic remains visible and is documented as editor plumbing.

### Task 7: Roll out, measure parity, and remove legacy paths

**Rollout order:**

1. Authentication and typed result contracts.
2. Durable requests/conversations.
3. MCP clarification.
4. Trusted attachment references.
5. Draft-safe generation.
6. Contextual MCP-only routing for internal users.
7. Global generation handoff.
8. General rollout after parity evidence.
9. Legacy write shutdown.
10. Endpoint and snapshot-path removal after telemetry confirms no remaining callers.

**Measure:**

- assessment status and question count,
- operation start/completion/failure/cancel,
- generated node/edge/binding counts,
- validation status,
- revision conflicts,
- rollback/revert success,
- attachment validation failures,
- generation compensation and conflicts,
- latency and tool/model errors,
- legacy fallback use.

**Remove after parity:**

- frontend direct semantic fallback branches,
- assistant use of direct `intent-design`,
- assistant use of direct construction start,
- direct `/playbooks/generate` when no non-assistant caller remains,
- legacy `/:id/design` when no caller remains,
- design-message append/clear writes,
- legacy snapshot revert after its approved compatibility window,
- obsolete agent-assistant fallback flag and env declarations.

Retain JWT construction stream, status, cancel, commit, Apply/Discard, and revert endpoints because they are Canvas control-plane APIs.

---

## Verification Plan

### MCP

- `cd mcp-playbook && python -m pytest -q`
- Verify exact tool inventories and typed output schemas.
- Verify bearer inspection and full actor runtime calls.
- Verify no direct patch, Apply/Discard, or runtime-HITL tools exist.

### Backend

- Focused Jest suites for connector auth/reconciliation, assistant request binding, clarification, attachments, generation compensation, operation commit/revert, and assistant policies.
- `cd YellowStorm/back && npm run build`
- Add revision-race, duplicate-request, cross-user, expiry, and cleanup tests.

### Agent Runtime

- `cd yellowstorm-adk && poetry run pytest tests/test_mascot_tool_policy.py -q`
- Verify global generation is allowed.
- Verify global existing-Playbook construction is denied.
- Verify execution still requires native confirmation.

### Frontend

- Focused Vitest suites for `PlaybookDesignerPanel`, `PlaybookCanvasPage`, `playbook-intent-flow`, Playbook API, Second Brain, and action bus.
- `cd YellowStorm/front && npm run build`
- Verify no assistant base64 payload appears in network requests to assistant/MCP paths.
- Verify ordered stream resume does not apply duplicate deltas.

### Browser QA

- Global search/open/validate/run/diagnose.
- Global new-draft generation and Canvas handoff.
- Contextual text and image updates.
- Multi-step clarification with custom and workspace/document choices.
- Existing graph update with one undo checkpoint.
- Cancel/failure rollback.
- Commit conflict and reload recovery.
- Advisor Apply/Discard.
- Operation history/revert.
- Native runtime HITL remains functional and is never answered by MCP.
- EN/FR, mobile/desktop, light/dark/configured themes, console, and network checks.

---

## Observability and Security

Emit structured events for:

- `playbook_assistant_turn_started/completed/failed`
- `playbook_assistant_assessment_completed`
- `playbook_assistant_clarification_continued/rejected`
- `playbook_assistant_attachment_initialized/confirmed/rejected/cleaned`
- `playbook_assistant_operation_started/completed/cancelled/failed`
- `playbook_assistant_generation_compensated/compensation_conflict`
- `playbook_assistant_commit_conflict`
- `playbook_assistant_revert_completed/rejected`
- `playbook_mcp_auth_rejected`
- `playbook_mcp_envelope_invalid`
- `playbook_assistant_legacy_fallback_used`

Log only opaque IDs, surface, tool, revision, status, latency, attachment count/aggregate size, correlation ID, and error code. Never log prompts, attachment bytes, filenames containing sensitive content, signed URLs, tool secrets, tokens, or full tool payloads.

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Connector cannot authenticate to MCP | Blocks all assistant tools | Make bearer reconciliation the first blocking phase and verify live inspection |
| Stale clarification modifies a newer graph | Data loss or wrong edits | Bind and compare revision at assessment, continuation, construction, and commit |
| Generation leaves orphan drafts | Product clutter and ambiguity | Backend-owned idempotent operation with revision-safe compensation |
| Attachment reference crosses users/requests | Security breach | Bind owner, actor, request, Playbook, revision, and expiry at every resolution |
| Base64 or signed URL reaches the model/MCP | Data exposure and payload bloat | Opaque attachment IDs and server-side resolution with tests |
| Global assistant edits existing Playbooks invisibly | Loss of user control | Separate allowlist enforced in connector, agent policy, and Nest |
| Typed MCP envelopes break ADK conversion | Runtime tool failure | String-only enums, schema inspection tests, and atomic connector update |
| More than one operation starts per turn | Duplicate changes | Existing result check plus unique request-level operation claim |
| Removing manual history reduces continuity | Worse assistant behavior | Persist conversation messages before removing prompt concatenation |
| Legacy snapshot revert overwrites newer edits | Data loss | Read-only legacy history and revision-gated temporary revert |
| Canvas mechanics regress during migration | Broken editor experience | Keep SSE/preview/undo/commit ownership unchanged and add parity tests |

---

## Final Acceptance Criteria

1. Both assistant surfaces expose one product identity with distinct context and permissions.
2. Every semantic Playbook capability used by either assistant is an allowlisted Playbook MCP tool.
3. Existing-Playbook updates initiated globally hand off to Canvas and do not commit invisibly.
4. Global new-Playbook generation is one idempotent, draft-safe operation.
5. Contextual text, images, and clarification use the MCP path exclusively.
6. Clarification answers are typed and bound to request, actor, operation kind, conversation, and attachments, plus Playbook/revision for existing-Playbook requests.
7. Base64 and signed attachment URLs never become MCP arguments or tool output.
8. Canvas still owns JWT SSE, local preview, one undo checkpoint, rollback, commit, Apply/Discard, and runtime HITL.
9. Construction/generation starts at most once per assistant turn/request.
10. All tools return `playbook.mcp.v1` typed success/error envelopes.
11. Full trusted actor identity is propagated and authoritative permissions remain in Nest.
12. Execution still requires fingerprint-bound native confirmation and idempotency.
13. Legacy direct semantic paths are removed only after parity telemetry and caller checks pass.
14. Focused MCP, backend, runtime, frontend, build, reviewer, security, and browser QA gates pass.

---

## Required Gates

- **Plan approval:** required before coding.
- **Security review:** required for MCP ingress, actor propagation, attachment authorization, and cleanup.
- **Reviewer:** required after each contract-bearing implementation phase; critical and major findings block progress.
- **Frontend QA:** required for clarification, images, generation handoff, Canvas preview/undo, and global assistant behavior.
- **Migration review:** required before deleting legacy history, snapshots, flags, or endpoints.
- **Memory:** Full update after verified implementation because this establishes durable assistant ownership and MCP contracts.
