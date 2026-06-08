# YellowStorm Playbook Realtime Node-by-Node Construction Implementation Plan

**Repository:** `YellowsysOrg/YellowStorm-poc`  
**Branch:** `aga-playbook-005`  
**Scope:** Playbook construction through intent suggestion inference logic  
**Goal:** Make playbook construction changes appear incrementally in the frontend in realtime, node by node.  
**Primary source focus:** `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent.service.ts`

---

## 1. Executive Summary

The current playbook intent construction flow is request/response based:

1. The frontend submits an intent.
2. The backend calls LiteLLM.
3. LiteLLM returns one full JSON object.
4. The backend normalizes all suggestions.
5. The frontend receives the full response.
6. The frontend applies the selected/top suggestion to the canvas.

This means the user sees no graph construction progress until the entire inference finishes.

The recommended implementation is a **job-based HTTP streaming construction pipeline**:

```text
React frontend
  -> POST /playbooks/:id/intent-constructions
      creates construction job and returns constructionId

React frontend
  -> GET /playbooks/:id/intent-constructions/:constructionId/stream
      receives ordered construction events

NestJS backend
  -> performs staged inference
  -> normalizes and validates every emitted graph delta
  -> streams application-ready node/edge/data-binding deltas

Optional internal layer
  -> gRPC from NestJS to a dedicated construction worker / ADK service
```

The frontend should not consume raw LLM tokens. It should consume only **normalized, validated, deterministic graph deltas**.

---

## 2. Current Branch Observations

The following observations are based on branch `aga-playbook-005`.

### Backend

Relevant file:

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent.service.ts
```

Current behavior:

- `PlaybookFlowIntentService.analyze()` performs the complete intent analysis in one call.
- It loads:
  - flow
  - selected node context
  - effective design settings
  - inference model
  - prompt template
  - default agents
  - node templates
- It renders the prompt.
- It calls LiteLLM `/v1/chat/completions`.
- It requests a complete JSON object using:

```ts
response_format: { type: 'json_object' }
```

- It then normalizes the full response through `normalizeSuggestions(...)`.
- It returns all suggestions at once.

Relevant controller:

```text
YellowStorm/back/src/modules/playbook-flow/controllers/playbook-flow.controller.ts
```

Current route:

```text
POST /playbooks/:id/intent
```

This route returns a non-streaming response.

### Frontend

Relevant file:

```text
YellowStorm/front/src/modules/playbook/api.ts
```

Current intent API helper:

```ts
requestPlaybookIntent(playbookId, data)
```

This performs a blocking Axios `POST` to:

```text
/playbooks/:id/intent
```

with a long timeout.

Relevant file:

```text
YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx
```

Important existing capabilities:

- The frontend already has deterministic intent suggestion application logic.
- `handleApplyIntentSuggestion(...)` already knows how to:
  - create deterministic node IDs
  - apply workflow plans
  - create/update/delete nodes
  - create/delete edges
  - create/delete data bindings
  - highlight changed nodes and edges
  - save the resulting playbook
- This function should be reused instead of creating a second graph application path.

Relevant existing frontend streaming pattern:

```text
YellowStorm/front/src/modules/playbook/api.ts
```

The file already contains `rewritePlaybookPromptStream(...)`, which uses `fetch(...).body.getReader()`. The new construction stream should follow this style.

---

## 3. Design Goals

### Functional Goals

1. Show new nodes on the frontend as soon as each node is ready.
2. Show edges/data bindings shortly after dependent nodes are available.
3. Preserve existing auto-apply behavior.
4. Preserve existing manual suggestions behavior where possible.
5. Keep the current blocking `/intent` endpoint for backwards compatibility.
6. Avoid raw-token parsing in the browser.
7. Prevent duplicate nodes when reconnecting or retrying.
8. Allow stream cancellation.
9. Make missed events recoverable where practical.

### Non-Functional Goals

1. Deterministic graph application.
2. Idempotent frontend updates.
3. Resumable or replayable construction events.
4. Clear event sequencing.
5. Good debugging through browser network tools.
6. Minimal disruption to existing playbook editing/autosave logic.
7. No direct browser-to-gRPC dependency.
8. Option to use gRPC internally later.

---

## 4. Recommended Transport Strategy

### Browser-Facing Transport

Use **HTTP streaming** from NestJS to the browser.

Recommended format:

```text
NDJSON over fetch streaming
```

Example response body:

```json
{"type":"started","constructionId":"...","sequence":0}
{"type":"node_delta","constructionId":"...","sequence":1,"suggestion":{...}}
{"type":"node_delta","constructionId":"...","sequence":2,"suggestion":{...}}
{"type":"edge_delta","constructionId":"...","sequence":3,"suggestion":{...}}
{"type":"completed","constructionId":"...","sequence":4}
```

Why NDJSON instead of raw SSE:

- Works with `POST` and `GET`.
- Easy to consume with `fetch().body.getReader()`.
- Easy to parse line by line.
- Fits the existing frontend stream style.
- Easier to include auth headers than `EventSource`.
- Easier to support cancellation through `AbortController`.

SSE is also acceptable, especially for the `GET /stream` endpoint, but NDJSON is the simpler fit for the current frontend codebase.

### gRPC

Use gRPC only for **internal backend-to-backend communication**, not browser-facing communication.

Good gRPC boundary:

```text
NestJS playbook-flow module
  -> gRPC streaming call
      -> yellowstorm-adk / construction worker
```

Bad gRPC boundary:

```text
React browser frontend
  -> gRPC directly
```

Reason: direct browser gRPC requires grpc-web/proxy setup and adds complexity without solving graph consistency by itself.

---

## 5. Target Architecture

```text
+------------------------+
| React Playbook Canvas  |
| PlaybookCanvasPage.tsx |
+-----------+------------+
            |
            | POST /playbooks/:id/intent-constructions
            v
+-----------------------------+
| NestJS Playbook Controller  |
+-------------+---------------+
              |
              | create construction job
              v
+-------------------------------+
| PlaybookFlowIntentConstruction |
| Service / In-memory store      |
+-------------+-----------------+
              |
              | staged inference
              v
+-------------------------------+
| PlaybookFlowIntentService      |
| existing normalization logic   |
+-------------+-----------------+
              |
              | optional internal gRPC
              v
+-------------------------------+
| ADK / Worker / Model service   |
+-------------------------------+

Frontend then connects:

GET /playbooks/:id/intent-constructions/:constructionId/stream

and applies events incrementally.
```

---

## 6. New Backend API Contract

### 6.1 Start Construction

```http
POST /playbooks/:id/intent-constructions
Content-Type: application/json
```

Request body:

```ts
interface StartPlaybookIntentConstructionDto {
  intent: string;
  selectedTaskId?: string;
  mode?: 'auto_apply' | 'suggest_only';
  clientConstructionId?: string;
}
```

Response:

```ts
interface StartPlaybookIntentConstructionResponse {
  constructionId: string;
  playbookId: string;
  basePlaybookUpdatedAt: string;
  status: 'queued' | 'running';
}
```

Notes:

- `clientConstructionId` can be supplied by frontend for idempotency.
- `basePlaybookUpdatedAt` is important for final save conflict detection.
- This endpoint should return quickly.

---

### 6.2 Stream Construction Events

```http
GET /playbooks/:id/intent-constructions/:constructionId/stream?after=0
Accept: application/x-ndjson
```

Response stream:

```ts
type PlaybookIntentConstructionStreamEvent =
  | PlaybookIntentConstructionStartedEvent
  | PlaybookIntentConstructionPlanEvent
  | PlaybookIntentConstructionNodeDeltaEvent
  | PlaybookIntentConstructionEdgeDeltaEvent
  | PlaybookIntentConstructionDataBindingDeltaEvent
  | PlaybookIntentConstructionSuggestionEvent
  | PlaybookIntentConstructionProgressEvent
  | PlaybookIntentConstructionCompletedEvent
  | PlaybookIntentConstructionFailedEvent
  | PlaybookIntentConstructionCancelledEvent;
```

Base event:

```ts
interface PlaybookIntentConstructionBaseEvent {
  constructionId: string;
  playbookId: string;
  sequence: number;
  createdAt: string;
}
```

Started event:

```ts
interface PlaybookIntentConstructionStartedEvent
  extends PlaybookIntentConstructionBaseEvent {
  type: 'started';
  model: string;
  basePlaybookUpdatedAt: string;
}
```

Plan event:

```ts
interface PlaybookIntentConstructionPlanEvent
  extends PlaybookIntentConstructionBaseEvent {
  type: 'plan';
  plan: {
    estimatedNodes: number;
    estimatedEdges: number;
    summary: string;
    steps: Array<{
      nodeRef: string;
      title: string;
      purpose: string;
    }>;
  };
}
```

Node delta event:

```ts
interface PlaybookIntentConstructionNodeDeltaEvent
  extends PlaybookIntentConstructionBaseEvent {
  type: 'node_delta';
  suggestion: PlaybookIntentSuggestion;
  nodeRef?: string;
  nodeIndex?: number;
  totalNodes?: number;
}
```

Edge delta event:

```ts
interface PlaybookIntentConstructionEdgeDeltaEvent
  extends PlaybookIntentConstructionBaseEvent {
  type: 'edge_delta';
  suggestion: PlaybookIntentSuggestion;
}
```

Data binding delta event:

```ts
interface PlaybookIntentConstructionDataBindingDeltaEvent
  extends PlaybookIntentConstructionBaseEvent {
  type: 'data_binding_delta';
  suggestion: PlaybookIntentSuggestion;
}
```

Generic suggestion event:

```ts
interface PlaybookIntentConstructionSuggestionEvent
  extends PlaybookIntentConstructionBaseEvent {
  type: 'suggestion';
  suggestion: PlaybookIntentSuggestion;
}
```

Progress event:

```ts
interface PlaybookIntentConstructionProgressEvent
  extends PlaybookIntentConstructionBaseEvent {
  type: 'progress';
  phase:
    | 'planning'
    | 'generating_node'
    | 'generating_edges'
    | 'validating'
    | 'saving_ready';
  message: string;
  current?: number;
  total?: number;
}
```

Completed event:

```ts
interface PlaybookIntentConstructionCompletedEvent
  extends PlaybookIntentConstructionBaseEvent {
  type: 'completed';
  model: string;
  settings: EffectivePlaybookDesignSettings;
  finalSuggestionCount: number;
}
```

Failed event:

```ts
interface PlaybookIntentConstructionFailedEvent
  extends PlaybookIntentConstructionBaseEvent {
  type: 'failed';
  message: string;
  recoverable: boolean;
}
```

Cancelled event:

```ts
interface PlaybookIntentConstructionCancelledEvent
  extends PlaybookIntentConstructionBaseEvent {
  type: 'cancelled';
  reason?: string;
}
```

---

### 6.3 Cancel Construction

```http
DELETE /playbooks/:id/intent-constructions/:constructionId
```

Response:

```ts
interface CancelPlaybookIntentConstructionResponse {
  constructionId: string;
  status: 'cancelled';
}
```

---

### 6.4 Optional Event Replay

```http
GET /playbooks/:id/intent-constructions/:constructionId/events?after=12
```

Response:

```ts
interface PlaybookIntentConstructionEventsResponse {
  constructionId: string;
  events: PlaybookIntentConstructionStreamEvent[];
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
}
```

This is useful if the stream disconnects and the frontend needs missed events.

---

## 7. Backend Implementation Plan

### Phase 1: Extract Reusable Intent Context Builder

File:

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent.service.ts
```

Create a private method:

```ts
private async buildIntentAnalysisContext(
  flowId: string,
  ownerId: string,
  dto: RequestPlaybookFlowIntentDto,
): Promise<PlaybookIntentAnalysisContext>
```

This method should contain the shared setup currently inside `analyze()`:

- get LiteLLM HTTP client
- load flow
- resolve selected node
- validate `selectedTaskId`
- resolve effective settings
- resolve model
- load prompt
- load default agents
- load node templates
- render system/user prompt
- build validation context

Suggested type:

```ts
interface PlaybookIntentAnalysisContext {
  httpClient: ReturnType<LiteLLMConnectionService['getHttpClient']>;
  flow: any;
  selectedNode: { id: string; label?: string; description?: string; metadata?: Record<string, unknown> } | null;
  effectiveSettings: EffectiveFlowDesignSettings;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  validationContext: IntentWorkflowValidationContext;
  limits: IntentNormalizationLimits;
}
```

Then update current `analyze()` to use it:

```ts
async analyze(...) {
  const ctx = await this.buildIntentAnalysisContext(flowId, ownerId, dto);

  const response = await ctx.httpClient.post('/v1/chat/completions', ...);

  return {
    suggestions: this.normalizeSuggestions(...),
    model: ctx.model,
    settings: ctx.effectiveSettings,
  };
}
```

This preserves the existing API.

---

### Phase 2: Add Construction Job Service

Create new file:

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent-construction.service.ts
```

Responsibilities:

- create construction jobs
- keep job status
- keep ordered event log
- expose async event stream
- support cancellation
- run staged inference
- emit normalized suggestions incrementally

Suggested in-memory implementation first:

```ts
@Injectable()
export class PlaybookFlowIntentConstructionService {
  private readonly jobs = new Map<string, PlaybookIntentConstructionJob>();

  async start(
    flowId: string,
    ownerId: string,
    dto: RequestPlaybookFlowIntentDto,
  ): Promise<StartPlaybookIntentConstructionResponse> {
    // create job
    // start async worker
    // return constructionId quickly
  }

  stream(
    flowId: string,
    ownerId: string,
    constructionId: string,
    afterSequence = 0,
  ): AsyncGenerator<PlaybookIntentConstructionStreamEvent> {
    // emit existing events after sequence
    // then wait for new events
  }

  cancel(constructionId: string): void {
    // abort model calls and emit cancelled event
  }
}
```

In-memory is acceptable for first implementation. Later, replace with Redis or database-backed event store for multi-instance deployments.

---

### Phase 3: Add Construction Event Store

Minimal structure:

```ts
interface PlaybookIntentConstructionJob {
  id: string;
  flowId: string;
  ownerId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  basePlaybookUpdatedAt: string;
  createdAt: Date;
  updatedAt: Date;
  events: PlaybookIntentConstructionStreamEvent[];
  abortController: AbortController;
  waiters: Set<() => void>;
}
```

Helper methods:

```ts
private appendEvent(
  job: PlaybookIntentConstructionJob,
  event: Omit<PlaybookIntentConstructionStreamEvent, 'sequence' | 'createdAt'>,
): PlaybookIntentConstructionStreamEvent
```

Rules:

- sequence starts at `1`
- every emitted event is appended before being streamed
- every event has `constructionId`, `playbookId`, `sequence`, `createdAt`
- event order is stable
- frontend can resume from `after=lastSequence`

---

### Phase 4: Implement Staged Construction Inference

Do not depend on partial JSON parsing.

Use staged calls:

#### Step A: Plan the construction

Ask the model for a small plan:

```json
{
  "summary": "Build a three-node workflow for invoice processing.",
  "nodes": [
    {
      "nodeRef": "extract_invoice",
      "title": "Extract invoice data",
      "purpose": "Read invoice and extract structured fields"
    },
    {
      "nodeRef": "validate_invoice",
      "title": "Validate invoice",
      "purpose": "Check required fields and totals"
    }
  ],
  "edges": [
    {
      "sourceNodeRef": "extract_invoice",
      "targetNodeRef": "validate_invoice"
    }
  ]
}
```

Emit:

```ts
{ type: 'plan', plan }
```

#### Step B: Generate each node independently

For each planned node:

```ts
for (const nodePlan of plan.nodes) {
  emit progress: generating_node

  const suggestion = await inferSingleNodeSuggestion(...);

  const normalized = normalizeSuggestions(...);

  emit node_delta
}
```

Each `node_delta` can be a `workflow_plan` containing one `create_node`, or a `single_change` with `operationType: create_node`.

Recommended shape for frontend compatibility:

```ts
{
  kind: 'workflow_plan',
  changes: [
    {
      type: 'create_node',
      nodeRef: nodePlan.nodeRef,
      anchor: {
        mode: 'append',
        targetTaskId: null,
        nodeRef: previousNodeRefOrNull
      },
      task: ...
    }
  ],
  impact: {
    nodesToCreate: 1,
    ...
  }
}
```

#### Step C: Generate edges after nodes exist

Once all node events have been emitted:

```ts
emit edge_delta with create_edge changes
```

This avoids frontend references to nodes that have not been created yet.

#### Step D: Generate data bindings after edges

After edge creation:

```ts
emit data_binding_delta with create_data_binding changes
```

This ensures source and target ports exist before binding.

---

### Phase 5: Reuse Normalization and Validation

The current service already has important methods:

- `normalizeSuggestions(...)`
- `normalizeWorkflowChange(...)`
- `validateWorkflowChange(...)`
- `buildValidationContext(...)`
- task/port normalization helpers

Do not duplicate these.

Add smaller helper methods if needed:

```ts
private normalizeConstructionSuggestion(
  raw: unknown,
  dto: RequestPlaybookFlowIntentDto,
  selectedTaskId: string | null,
  limits: IntentNormalizationLimits,
  validationContext: IntentWorkflowValidationContext,
): PlaybookIntentSuggestion | null
```

For streamed construction, validation context must evolve as nodes are emitted.

Important: if the backend validates `create_edge` against `createdNodeRefs`, the construction service must track refs emitted earlier.

Suggested context extension:

```ts
interface StreamingIntentWorkflowValidationContext extends IntentWorkflowValidationContext {
  createdNodeRefs: Set<string>;
}
```

However, do not weaken existing validation. Add a streaming-specific validation layer that can validate references to already-emitted node refs.

---

### Phase 6: Add Controller Routes

File:

```text
YellowStorm/back/src/modules/playbook-flow/controllers/playbook-flow.controller.ts
```

Add imports:

```ts
import { Res, Query } from '@nestjs/common';
import type { Response } from 'express';
```

Add service injection:

```ts
private readonly intentConstructionService: PlaybookFlowIntentConstructionService
```

Add routes:

```ts
@Post(':id/intent-constructions')
@ApiOperation({ summary: 'Start a realtime playbook intent construction job' })
@RequirePermissions(Permissions.PLAYBOOK_UPDATE)
async startIntentConstruction(
  @CurrentUser('_id') userId: string,
  @Param('id') id: string,
  @Body() dto: RequestPlaybookFlowIntentDto,
) {
  return this.intentConstructionService.start(id, userId, dto);
}
```

```ts
@Get(':id/intent-constructions/:constructionId/stream')
@ApiOperation({ summary: 'Stream realtime playbook intent construction events' })
@RequirePermissions(Permissions.PLAYBOOK_READ)
async streamIntentConstruction(
  @CurrentUser('_id') userId: string,
  @Param('id') id: string,
  @Param('constructionId') constructionId: string,
  @Query('after') after: string | undefined,
  @Res() res: Response,
) {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const afterSequence = Number(after || 0) || 0;

  try {
    for await (const event of this.intentConstructionService.stream(id, userId, constructionId, afterSequence)) {
      res.write(`${JSON.stringify(event)}\n`);
    }
  } finally {
    res.end();
  }
}
```

```ts
@Delete(':id/intent-constructions/:constructionId')
@ApiOperation({ summary: 'Cancel a realtime playbook intent construction job' })
@RequirePermissions(Permissions.PLAYBOOK_UPDATE)
async cancelIntentConstruction(
  @CurrentUser('_id') userId: string,
  @Param('id') id: string,
  @Param('constructionId') constructionId: string,
) {
  return this.intentConstructionService.cancel(id, userId, constructionId);
}
```

---

### Phase 7: Register Service in Module

File:

```text
YellowStorm/back/src/modules/playbook-flow/playbook-flow.module.ts
```

Add provider:

```ts
PlaybookFlowIntentConstructionService
```

---

## 8. Frontend Implementation Plan

### Phase 1: Add Types

File:

```text
YellowStorm/front/src/modules/playbook/types.ts
```

Add:

```ts
export interface StartPlaybookIntentConstructionResponse {
  constructionId: string;
  playbookId: string;
  basePlaybookUpdatedAt: string;
  status: 'queued' | 'running';
}
```

Add event union:

```ts
export type PlaybookIntentConstructionEvent =
  | {
      type: 'started';
      constructionId: string;
      playbookId: string;
      sequence: number;
      createdAt: string;
      model: string;
      basePlaybookUpdatedAt: string;
    }
  | {
      type: 'plan';
      constructionId: string;
      playbookId: string;
      sequence: number;
      createdAt: string;
      plan: {
        estimatedNodes: number;
        estimatedEdges: number;
        summary: string;
        steps: Array<{
          nodeRef: string;
          title: string;
          purpose: string;
        }>;
      };
    }
  | {
      type: 'node_delta' | 'edge_delta' | 'data_binding_delta' | 'suggestion';
      constructionId: string;
      playbookId: string;
      sequence: number;
      createdAt: string;
      suggestion: PlaybookIntentSuggestion;
      nodeRef?: string;
      nodeIndex?: number;
      totalNodes?: number;
    }
  | {
      type: 'progress';
      constructionId: string;
      playbookId: string;
      sequence: number;
      createdAt: string;
      phase: string;
      message: string;
      current?: number;
      total?: number;
    }
  | {
      type: 'completed';
      constructionId: string;
      playbookId: string;
      sequence: number;
      createdAt: string;
      model: string;
      settings: EffectivePlaybookDesignSettings;
      finalSuggestionCount: number;
    }
  | {
      type: 'failed';
      constructionId: string;
      playbookId: string;
      sequence: number;
      createdAt: string;
      message: string;
      recoverable: boolean;
    }
  | {
      type: 'cancelled';
      constructionId: string;
      playbookId: string;
      sequence: number;
      createdAt: string;
      reason?: string;
    };
```

---

### Phase 2: Add Endpoint Config

File:

```text
YellowStorm/front/src/lib/api/config.ts
```

Add under `API_ENDPOINTS.playbooks`:

```ts
intentConstruction: (id: string) => `/playbooks/${id}/intent-constructions`,
intentConstructionStream: (id: string, constructionId: string) =>
  `/playbooks/${id}/intent-constructions/${constructionId}/stream`,
```

---

### Phase 3: Add API Helpers

File:

```text
YellowStorm/front/src/modules/playbook/api.ts
```

Add:

```ts
export async function startPlaybookIntentConstruction(
  playbookId: string,
  data: RequestPlaybookIntentData,
): Promise<StartPlaybookIntentConstructionResponse> {
  const response = await apiClient.post<ApiResponse<StartPlaybookIntentConstructionResponse>>(
    API_ENDPOINTS.playbooks.intentConstruction(playbookId),
    data,
    { timeout: 30000 },
  );

  return response.data.data;
}
```

Add stream helper:

```ts
export async function streamPlaybookIntentConstruction(
  playbookId: string,
  constructionId: string,
  options: {
    after?: number;
    signal?: AbortSignal;
    onEvent: (event: PlaybookIntentConstructionEvent) => void;
  },
): Promise<void> {
  const token = localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
  const url = new URL(
    `${API_CONFIG.baseURL}${API_ENDPOINTS.playbooks.intentConstructionStream(playbookId, constructionId)}`,
  );

  if (options.after) {
    url.searchParams.set('after', String(options.after));
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/x-ndjson',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'include',
    signal: options.signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Construction stream failed with status ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      options.onEvent(JSON.parse(trimmed) as PlaybookIntentConstructionEvent);
    }
  }

  buffer += decoder.decode();
  const tail = buffer.trim();

  if (tail) {
    options.onEvent(JSON.parse(tail) as PlaybookIntentConstructionEvent);
  }
}
```

---

### Phase 4: Add Store Actions

File:

```text
YellowStorm/front/src/modules/playbook/store.ts
```

Option A: Keep construction logic inside `PlaybookCanvasPage.tsx`.

Option B: Add store actions for construction API calls.

Recommended minimal approach:

- Add API helpers only.
- Keep stream consumption in `PlaybookCanvasPage.tsx`, because graph application already lives there.

Later refactor into store only if multiple pages need construction streams.

---

### Phase 5: Refactor `handleApplyIntentSuggestion`

File:

```text
YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx
```

Current function saves immediately after applying a suggestion.

Add options:

```ts
type ApplyIntentSuggestionOptions = {
  replaceAll?: boolean;
  expectedUpdatedAt?: string;
  save?: boolean;
  clearSuggestions?: boolean;
  focus?: boolean;
};
```

Default behavior should remain unchanged:

```ts
save = true
clearSuggestions = true
focus = true
```

Change internal commits:

```ts
const shouldSave = options?.save !== false;
const shouldClearSuggestions = options?.clearSuggestions !== false;
const shouldFocus = options?.focus !== false;
```

Inside `commitGraph(...)`:

```ts
if (shouldClearSuggestions) {
  setIntentSuggestions([]);
}
```

For focus:

```ts
if (shouldFocus) {
  focusChangedArea(layoutedTasks, changedIds, deletedBounds);
} else {
  scheduleChangeFeedbackCleanup();
}
```

Where it currently calls:

```ts
void saveCurrentPlaybook(...)
```

wrap with:

```ts
if (shouldSave) {
  void saveCurrentPlaybook({
    expectedUpdatedAt: suggestionBaseUpdatedAt,
    clientMutationId: suggestionApplicationKey,
  });
}
```

This allows streaming application without saving after each node.

---

### Phase 6: Add Streaming State to `PlaybookCanvasPage.tsx`

Add state:

```ts
const [intentConstructionId, setIntentConstructionId] = useState<string | null>(null);
const [intentConstructionStatus, setIntentConstructionStatus] = useState<
  'idle' | 'starting' | 'streaming' | 'completed' | 'failed' | 'cancelled'
>('idle');
const [intentConstructionProgress, setIntentConstructionProgress] = useState('');
const [intentConstructionSequence, setIntentConstructionSequence] = useState(0);
const intentConstructionAbortRef = useRef<AbortController | null>(null);
const intentConstructionBaseUpdatedAtRef = useRef<string | null>(null);
const intentConstructionAppliedSuggestionsRef = useRef<Set<string>>(new Set());
```

---

### Phase 7: Add Submit Flow for Realtime Construction

Replace or branch inside `handleSubmitIntent`.

Recommended behavior:

- If `intentAutoApply === true`, use realtime construction stream.
- If `intentAutoApply === false`, keep existing blocking suggestion list.
- Add fallback to blocking call if streaming start fails.

Pseudo-code:

```ts
const handleSubmitIntent = useCallback(async () => {
  const normalizedIntent = intentValue.trim();

  if (!id || !playbook || normalizedIntent.length < 3) {
    return;
  }

  const resolvedSelectedTaskId = selectedStepId && playbook.tasks.some((task) => task.id === selectedStepId)
    ? selectedStepId
    : undefined;

  if (!intentAutoApply) {
    // keep existing runIntentAnalysis flow
    return runBlockingIntentAnalysis();
  }

  setIntentLoading(true);
  setIntentError('');
  setIntentSuggestions([]);
  setLastIntentSuggestions([]);
  setIntentConstructionStatus('starting');
  setIntentConstructionProgress('Starting construction...');
  intentConstructionAppliedSuggestionsRef.current = new Set();

  const abortController = new AbortController();
  intentConstructionAbortRef.current = abortController;

  try {
    if (isDirty) {
      await saveNow();
    }

    const start = await startPlaybookIntentConstruction(id, {
      intent: normalizedIntent,
      selectedTaskId: resolvedSelectedTaskId,
    });

    setIntentConstructionId(start.constructionId);
    intentConstructionBaseUpdatedAtRef.current = start.basePlaybookUpdatedAt;
    setIntentConstructionStatus('streaming');

    await streamPlaybookIntentConstruction(id, start.constructionId, {
      signal: abortController.signal,
      after: 0,
      onEvent: (event) => {
        setIntentConstructionSequence(event.sequence);

        if (event.type === 'progress') {
          setIntentConstructionProgress(event.message);
          return;
        }

        if (event.type === 'plan') {
          setIntentConstructionProgress(
            `Building ${event.plan.estimatedNodes} nodes...`,
          );
          return;
        }

        if (
          event.type === 'node_delta'
          || event.type === 'edge_delta'
          || event.type === 'data_binding_delta'
          || event.type === 'suggestion'
        ) {
          const key = `${event.constructionId}:${event.sequence}`;
          if (intentConstructionAppliedSuggestionsRef.current.has(key)) {
            return;
          }

          intentConstructionAppliedSuggestionsRef.current.add(key);

          setIntentSuggestions((prev) => [...prev, event.suggestion]);

          addIntentSuggestionHistoryEntry(
            id,
            playbook.name,
            event.suggestion,
            normalizedIntent,
          );

          handleApplyIntentSuggestion(event.suggestion, {
            expectedUpdatedAt: intentConstructionBaseUpdatedAtRef.current || playbook.updatedAt,
            save: false,
            clearSuggestions: false,
            focus: true,
          });

          if (event.type === 'node_delta' && event.nodeIndex && event.totalNodes) {
            setIntentConstructionProgress(
              `Built node ${event.nodeIndex} of ${event.totalNodes}`,
            );
          }

          return;
        }

        if (event.type === 'completed') {
          setIntentConstructionStatus('completed');
          setIntentConstructionProgress('Construction completed');
        }

        if (event.type === 'failed') {
          setIntentConstructionStatus('failed');
          setIntentError(event.message);
        }
      },
    });

    await saveCurrentPlaybook({
      expectedUpdatedAt: intentConstructionBaseUpdatedAtRef.current || undefined,
      clientMutationId: `intent-construction-${start.constructionId}`,
    });

    setIntentSuggestions([]);
    setLastIntentSuggestions([]);
  } catch (error) {
    if (abortController.signal.aborted) {
      setIntentConstructionStatus('cancelled');
      return;
    }

    setIntentConstructionStatus('failed');
    setIntentError(error instanceof Error ? error.message : t('intentBar.error'));

    // Optional fallback:
    // await runBlockingIntentAnalysis();
  } finally {
    setIntentLoading(false);
    intentConstructionAbortRef.current = null;
  }
}, [...]);
```

---

### Phase 8: Add Cancel Button / UX

File:

```text
YellowStorm/front/src/modules/playbook/components/PlaybookIntentBar.tsx
```

Add optional props:

```ts
constructionStatus?: 'idle' | 'starting' | 'streaming' | 'completed' | 'failed' | 'cancelled';
constructionProgress?: string;
onCancelConstruction?: () => void;
```

Display:

```tsx
{constructionStatus === 'streaming' ? (
  <p className="text-xs text-muted-foreground">
    {constructionProgress || t('intentBar.construction.building')}
  </p>
) : null}
```

Add cancel button while streaming:

```tsx
<Button
  type="button"
  variant="outline"
  size="sm"
  onClick={onCancelConstruction}
>
  {t('intentBar.actions.cancel')}
</Button>
```

Parent cancel handler:

```ts
const handleCancelIntentConstruction = useCallback(() => {
  intentConstructionAbortRef.current?.abort();

  if (id && intentConstructionId) {
    void cancelPlaybookIntentConstruction(id, intentConstructionId);
  }

  setIntentConstructionStatus('cancelled');
  setIntentConstructionProgress('');
  setIntentLoading(false);
}, [id, intentConstructionId]);
```

---

## 9. Determinism and Idempotency Rules

### Rule 1: Every streamed graph delta must have a sequence number

Frontend must ignore duplicate event keys:

```ts
`${constructionId}:${sequence}`
```

### Rule 2: Suggestion IDs must be deterministic

Current frontend uses:

```text
createIntentSuggestionApplicationKey(...)
createIntentSuggestionNodeId(...)
createIntentSuggestionBindingId(...)
```

Continue to rely on these.

### Rule 3: Backend must not stream invalid graph references

Do not emit `create_edge` for a `nodeRef` that has not already been emitted unless the suggestion contains both node and edge in the same atomic `workflow_plan`.

Preferred sequence:

1. node deltas
2. edge deltas
3. data binding deltas

### Rule 4: Frontend saves once at completion

During stream:

```ts
handleApplyIntentSuggestion(..., { save: false })
```

On completion:

```ts
saveCurrentPlaybook(...)
```

This avoids repeated version conflicts and excessive PATCH calls.

### Rule 5: Keep the blocking endpoint

Do not remove:

```text
POST /playbooks/:id/intent
```

It remains useful for:

- manual suggestion mode
- fallback
- tests
- older clients

---

## 10. Internal gRPC Option

If a separate construction worker is desired, introduce gRPC behind NestJS.

### Suggested proto

```proto
syntax = "proto3";

package yellowstorm.playbook.construction;

service PlaybookConstructionService {
  rpc ConstructPlaybookIntent(ConstructPlaybookIntentRequest)
      returns (stream ConstructPlaybookIntentEvent);
  rpc CancelConstruction(CancelConstructionRequest)
      returns (CancelConstructionResponse);
}

message ConstructPlaybookIntentRequest {
  string construction_id = 1;
  string playbook_id = 2;
  string owner_id = 3;
  string intent = 4;
  optional string selected_task_id = 5;
  string workflow_summary_json = 6;
  string default_agents_json = 7;
  string node_templates_json = 8;
}

message ConstructPlaybookIntentEvent {
  string construction_id = 1;
  int64 sequence = 2;
  string type = 3;
  string payload_json = 4;
}

message CancelConstructionRequest {
  string construction_id = 1;
}

message CancelConstructionResponse {
  string construction_id = 1;
  string status = 2;
}
```

NestJS remains responsible for:

- auth
- permission checks
- HTTP stream to browser
- final validation
- event sequencing
- idempotency
- persistence/replay

Worker is responsible for:

- staged inference
- construction planning
- returning candidate deltas

---

## 11. Prompting Strategy for Staged Inference

### Planning Prompt

Goal: produce a compact deterministic plan, not full node definitions.

System instruction:

```text
Return JSON only.
Plan a playbook construction.
Do not include implementation details that depend on unavailable ports.
Use stable nodeRef values in snake_case.
```

Expected response:

```json
{
  "summary": "...",
  "nodes": [
    {
      "nodeRef": "extract_invoice_data",
      "title": "Extract invoice data",
      "purpose": "Read invoice files and extract structured invoice fields"
    }
  ],
  "edges": [
    {
      "sourceNodeRef": "extract_invoice_data",
      "targetNodeRef": "validate_invoice_data"
    }
  ]
}
```

### Per-Node Prompt

Goal: generate one complete node draft.

Input:

- intent
- global plan
- node plan
- existing workflow summary
- already emitted nodes
- default agents
- node templates

Expected response:

```json
{
  "suggestions": [
    {
      "id": "node-extract-invoice-data",
      "kind": "workflow_plan",
      "label": "Add Extract invoice data",
      "summary": "Adds a node that extracts structured fields from invoice documents.",
      "reason": "The playbook needs a first step to transform unstructured invoice input into structured data.",
      "confidence": 0.91,
      "impact": {
        "nodesToCreate": 1,
        "nodesToUpdate": 0,
        "nodesToDelete": 0,
        "edgesToCreate": 0,
        "edgesToDelete": 0,
        "dataBindingsToCreate": 0,
        "dataBindingsToDelete": 0,
        "affectedTaskIds": [],
        "businessOutcome": "Invoice data becomes available for downstream validation."
      },
      "changes": [
        {
          "type": "create_node",
          "nodeRef": "extract_invoice_data",
          "anchor": {
            "mode": "append",
            "targetTaskId": null,
            "nodeRef": null
          },
          "task": {
            "title": "Extract invoice data",
            "description": "Read invoice documents and extract vendor, date, amount, taxes, and line items.",
            "agentSlug": "document-analyst",
            "templateType": "agent",
            "inputPorts": [
              {
                "id": "invoice_document",
                "name": "Invoice document",
                "artifactKind": "document",
                "required": true
              }
            ],
            "outputPorts": [
              {
                "id": "invoice_data",
                "name": "Invoice data",
                "artifactKind": "data"
              }
            ]
          }
        }
      ],
      "isDirectIntentFallback": false
    }
  ]
}
```

### Edge Prompt

Goal: connect already-created nodes.

Expected response:

```json
{
  "suggestions": [
    {
      "kind": "workflow_plan",
      "changes": [
        {
          "type": "create_edge",
          "sourceNodeRef": "extract_invoice_data",
          "targetNodeRef": "validate_invoice_data",
          "sourceTaskId": null,
          "targetTaskId": null,
          "sourceOutputPortId": "invoice_data",
          "targetInputPortId": "invoice_data"
        }
      ]
    }
  ]
}
```

---

## 12. Testing Plan

### Backend Unit Tests

File:

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent-construction.service.spec.ts
```

Test cases:

1. `start()` returns a construction ID quickly.
2. `stream()` emits `started`.
3. `stream()` emits `plan`.
4. `stream()` emits each node as a separate event.
5. event sequence numbers are strictly increasing.
6. duplicate `clientConstructionId` does not create duplicate jobs.
7. cancellation emits `cancelled`.
8. failed model call emits `failed`.
9. invalid node suggestions are not emitted.
10. edge suggestions referencing missing nodes are skipped.
11. completed event is always terminal.
12. event replay with `after` returns only newer events.

### Backend Controller Tests

Test:

1. `POST /intent-constructions` requires update permission.
2. `GET /intent-constructions/:id/stream` requires read permission.
3. stream content type is `application/x-ndjson`.
4. stream writes valid JSON lines.
5. delete route cancels job.

### Frontend API Tests

Test:

1. `startPlaybookIntentConstruction` calls the correct endpoint.
2. `streamPlaybookIntentConstruction` parses multiple NDJSON chunks.
3. parser handles split JSON lines across chunks.
4. parser handles final line without trailing newline.
5. abort signal cancels stream.

### Frontend Component Tests

Test:

1. auto-apply uses streaming path.
2. manual mode still uses blocking path.
3. each `node_delta` calls `handleApplyIntentSuggestion`.
4. each streamed node appears in the canvas.
5. duplicate event sequence is ignored.
6. completion triggers one final save.
7. cancellation stops loading state.
8. failed event displays error.
9. progress text is displayed.

### E2E Test

Scenario:

1. Open a playbook.
2. Enter intent: “build a three-step invoice validation workflow”.
3. Click suggest/build.
4. Assert first node appears before final completion.
5. Assert second node appears later.
6. Assert final edges appear.
7. Assert playbook is saved once at completion.
8. Reload page.
9. Assert graph persists.

---

## 13. Rollout Strategy

### Step 1: Add backend stream behind new endpoint

Do not modify existing `/intent`.

### Step 2: Add frontend API helper

No UI behavior change yet.

### Step 3: Add feature flag

Optional flag:

```ts
VITE_PLAYBOOK_INTENT_CONSTRUCTION_STREAMING=true
```

or backend/system setting:

```ts
playbookIntentConstructionStreamingEnabled
```

### Step 4: Enable only for auto-apply

Manual suggestion mode continues to use old endpoint.

### Step 5: Add fallback

If streaming fails before first node:

```text
fallback to existing requestPlaybookIntent()
```

If streaming fails after nodes were applied:

```text
show recoverable error and let user save/discard current graph
```

### Step 6: Persist event log if needed

Start with in-memory event store.

Move to Redis/database if:

- multiple backend instances run
- reconnect/replay must survive restarts
- construction jobs last long
- auditability is required

---

## 14. Failure Handling

### Stream disconnect

Frontend:

1. remember `lastSequence`
2. reconnect with `after=lastSequence`
3. ignore duplicate sequence keys

### Model failure before any node

Frontend:

1. show error
2. optionally fallback to blocking endpoint

### Model failure after some nodes

Frontend:

1. keep already-applied nodes
2. show warning:
   - “Construction stopped after 2 nodes.”
3. offer:
   - save partial graph
   - discard via undo
   - retry from current graph

### Save conflict at completion

If `saveCurrentPlaybook` fails due to `expectedUpdatedAt` conflict:

1. do not silently overwrite
2. show conflict message
3. offer reload or manual merge
4. keep local dirty graph if possible

### User cancels

1. abort fetch stream
2. call backend cancel endpoint
3. stop progress
4. keep already-applied graph as local unsaved changes
5. allow undo

---

## 15. Performance Considerations

### Avoid applying too many React updates

If model emits many small deltas, batch UI updates.

Recommended:

- apply node delta immediately
- apply edge/data-binding deltas in small groups
- throttle progress text updates if needed

### Avoid saving after every node

Save once on completion.

Optional autosave checkpoint:

```text
save every 5 nodes or every 10 seconds
```

only if construction can be very long.

### Keep event payloads small

Do not stream:

- full workflow summary repeatedly
- full prompt
- raw LLM token stream
- full playbook snapshot

Stream only:

- event metadata
- one suggestion/delta
- concise progress text

---

## 16. Security and Permissions

Start endpoint:

```text
PLAYBOOK_UPDATE
```

Stream endpoint:

```text
PLAYBOOK_READ
```

Cancel endpoint:

```text
PLAYBOOK_UPDATE
```

Additional checks:

- construction job owner must match current user
- construction job playbook ID must match route playbook ID
- selected task ID must belong to playbook
- streamed events must not include prompt internals or sensitive model traces
- do not expose raw LiteLLM errors to user; sanitize messages

---

## 17. Files to Modify

### Backend

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent.service.ts
```

- extract reusable context builder
- add smaller normalization helper if needed

```text
YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent-construction.service.ts
```

- new construction job service
- event store
- staged inference orchestration
- cancellation support

```text
YellowStorm/back/src/modules/playbook-flow/controllers/playbook-flow.controller.ts
```

- add start stream/cancel routes

```text
YellowStorm/back/src/modules/playbook-flow/playbook-flow.module.ts
```

- register new service

Optional DTO file:

```text
YellowStorm/back/src/modules/playbook-flow/dto/start-playbook-flow-intent-construction.dto.ts
```

Optional interface file:

```text
YellowStorm/back/src/modules/playbook-flow/interfaces/playbook-flow-intent-construction.interface.ts
```

### Frontend

```text
YellowStorm/front/src/lib/api/config.ts
```

- add construction endpoints

```text
YellowStorm/front/src/modules/playbook/types.ts
```

- add construction response/event types

```text
YellowStorm/front/src/modules/playbook/api.ts
```

- add start/stream/cancel API helpers

```text
YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx
```

- consume stream
- apply deltas incrementally
- save once at completion
- handle abort/reconnect/error

```text
YellowStorm/front/src/modules/playbook/components/PlaybookIntentBar.tsx
```

- show construction progress
- add cancel action

Localization files:

```text
YellowStorm/front/src/modules/localization/...
```

Add keys:

```text
intentBar.construction.starting
intentBar.construction.building
intentBar.construction.completed
intentBar.construction.failed
intentBar.actions.cancel
```

---

## 18. Implementation Checklist

### Backend

- [ ] Extract `buildIntentAnalysisContext(...)`.
- [ ] Keep existing `analyze(...)` behavior unchanged.
- [ ] Create construction event types.
- [ ] Create construction service.
- [ ] Implement in-memory job store.
- [ ] Implement event append and sequence logic.
- [ ] Implement async stream generator.
- [ ] Implement cancellation.
- [ ] Implement planning inference call.
- [ ] Implement per-node inference calls.
- [ ] Implement edge inference call.
- [ ] Implement data-binding inference call.
- [ ] Normalize every emitted suggestion.
- [ ] Validate every emitted suggestion.
- [ ] Add start route.
- [ ] Add stream route.
- [ ] Add cancel route.
- [ ] Register service in module.
- [ ] Add backend tests.

### Frontend

- [ ] Add endpoint config.
- [ ] Add construction event types.
- [ ] Add `startPlaybookIntentConstruction`.
- [ ] Add `streamPlaybookIntentConstruction`.
- [ ] Add `cancelPlaybookIntentConstruction`.
- [ ] Refactor `handleApplyIntentSuggestion` options.
- [ ] Add construction state.
- [ ] Add streaming auto-apply path.
- [ ] Keep manual mode blocking path.
- [ ] Add progress UI.
- [ ] Add cancel UI.
- [ ] Ignore duplicate event sequences.
- [ ] Save once on completion.
- [ ] Add fallback behavior.
- [ ] Add frontend tests.

### Optional gRPC

- [ ] Define proto.
- [ ] Implement worker service.
- [ ] Add NestJS gRPC client.
- [ ] Keep final validation in NestJS.
- [ ] Keep browser-facing stream as HTTP NDJSON.

---

## 19. Acceptance Criteria

1. When auto-apply is enabled, nodes appear one by one during construction.
2. The first node appears before the full model construction is complete.
3. Edges are added only after referenced nodes exist.
4. Data bindings are added only after referenced ports exist.
5. The user sees progress text during construction.
6. The user can cancel construction.
7. Duplicate stream events do not create duplicate nodes.
8. The graph is saved once after successful completion.
9. Existing blocking `/intent` behavior still works.
10. Manual suggestion mode still works.
11. Streaming failure before graph mutation can fallback to the old flow.
12. Streaming failure after partial graph mutation does not corrupt the canvas.
13. Reconnecting with `after=sequence` does not replay already-applied graph changes.
14. The implementation remains branch-local to `aga-playbook-005`.

---

## 20. Recommended First Pull Request Scope

Keep the first PR focused and safe:

1. Backend:
   - add construction service
   - add start/stream/cancel endpoints
   - implement staged inference using current LiteLLM HTTP client
   - in-memory event store only

2. Frontend:
   - add API helpers
   - add stream consumption for auto-apply only
   - refactor `handleApplyIntentSuggestion` to support `save: false`
   - save once on completion
   - add minimal progress/cancel UI

3. Tests:
   - backend event sequencing
   - frontend NDJSON parser
   - frontend duplicate-event ignore
   - one integration-style canvas construction test

Do not include internal gRPC in the first PR unless the construction worker already exists. Add gRPC later as a backend-internal optimization.

---

## 21. Final Recommendation

Use this layered design:

```text
Frontend realtime:
  HTTP NDJSON stream

Backend orchestration:
  NestJS construction job service

Graph updates:
  normalized, validated PlaybookIntentSuggestion deltas

Persistence:
  one final save after completion

Reliability:
  constructionId + sequence + idempotent deterministic graph IDs

Optional internal service communication:
  gRPC only behind NestJS
```

This gives the best balance between realtime UX, reliability, browser compatibility, and minimal disruption to the current YellowStorm playbook code.
