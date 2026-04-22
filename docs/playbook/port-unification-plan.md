# Playbook Port Unification — Implementation Plan

Date: 2026-04-20
Scope: playbook execution engine (NestJS backend + Python/LangGraph ADK + gRPC contract)

## 1. Problem Statement

Playbook nodes currently use two incompatible data planes:

- **Action nodes** (`executionMode="action"`) exchange **typed artifacts** keyed by `port_id` with structured `metadata` (document IDs, status, etc.).
- **Agent nodes** (`executionMode="agent"`) receive inputs as a **stringified prompt context** (`context_from_dependencies`) plus a side-channel `workspace_context`, and emit free-form `Component`s where `output_port_id` is only an LLM hint.

Consequences:

1. Structure is lost at every action→agent boundary (document IDs, indexing status, etc. flattened to prose).
2. Port contracts are not enforced on agent outputs (LLM can drop or misroute them).
3. The graph service maintains parallel routing paths (`context_from_dependencies`, `workspace_context`, `input_files_by_port`, `upstream_results`).
4. Per-port isolation disappears for agents: all upstream documents merge into one context.
5. Replay/determinism is weakened when agents rely on prompt-embedded prose rather than typed state.

## 2. Goal

Unify the data plane around a **single typed envelope** (`PortPayload`) carried through LangGraph state, with identical input/output contracts for action and agent nodes. Preserve determinism by making all I/O **push-based along graph edges** (no runtime tool pulls by the LLM).

### Non-Goals

- No change to the playbook authoring UI model (`inputPorts` / `outputPorts` stay as declared).
- No change to edge semantics (`sourceOutputPortId → targetInputPortId`).
- No change to MongoDB persistence schema for historical executions (read-time compatibility only).

## 3. Target Data Model

### 3.1 `PortPayload` (canonical envelope)

```python
# yellowstorm-adk/src/langgraph_engine/types/port_payload.py
class PortPayload(BaseModel):
    port_id: str
    artifact_kind: Literal["text", "document", "code", "image", "data", "dashboard"]

    # Exactly one of these is set, based on artifact_kind:
    content: Optional[str] = None          # text | code (inline)
    ref: Optional[ArtifactRef] = None      # document | image | dashboard (by reference)
    data: Optional[dict] = None            # structured data (JSON-serializable)

    metadata: dict = Field(default_factory=dict)
    # Free-form but conventional keys:
    #   document_id, workspace_id, mime_type, filename, indexing_status,
    #   schema_ref (optional JSON-schema URI for `data`)

    # Provenance (set by the edge shim, not by the node):
    source_task_id: Optional[str] = None
    source_port_id: Optional[str] = None
    produced_at: Optional[datetime] = None

class ArtifactRef(BaseModel):
    document_id: Optional[str] = None
    workspace_id: Optional[str] = None
    url: Optional[str] = None
    filename: Optional[str] = None
    mime_type: Optional[str] = None
```

### 3.2 `NodeInputs` and `Emission`

```python
# Frozen input view handed to a node at execution time
NodeInputs = dict[str, list[PortPayload]]   # keyed by input port_id

# Canonical output shape produced by any node (action or agent)
class Emission(BaseModel):
    ports: dict[str, list[PortPayload]]     # keys constrained to declared output port_ids
    # Kept out of `ports`:
    tool_trace: list[ToolCall] = []
    llm_prompt_trace: Optional[str] = None
    error: Optional[str] = None
```

### 3.3 LangGraph state

```python
# yellowstorm-adk/src/langgraph_engine/state.py
class PlaybookState(TypedDict):
    artifacts: Annotated[
        dict[TaskId, dict[PortId, list[PortPayload]]],
        merge_artifacts_reducer,
    ]
    trigger: Optional[TriggerContext]
    execution_id: str
    user_context: UserContext
```

The reducer is additive per `(task_id, port_id)` (no silent overwrite). Re-running a task (retry / replay) replaces its own entry atomically.

## 4. Architecture Changes

### 4.1 Python ADK / LangGraph

#### 4.1.1 Edge resolution shim (pre-node, pure function)

New module: `yellowstorm-adk/src/langgraph_engine/port_routing.py`

```python
def resolve_node_inputs(
    state: PlaybookState,
    task: PlaybookTask,
    incoming_edges: list[PlaybookEdge],
) -> NodeInputs:
    """
    Pure function. For each incoming edge, reads
    state.artifacts[edge.source_id][edge.source_output_port_id]
    and groups payloads by edge.target_input_port_id.
    Stamps provenance. Returns a frozen view.
    """
```

Replaces the fragmented extraction logic currently spread across `playbook-execution-graph.service.ts:99–256` and `port_resolution.py`.

#### 4.1.2 Action executor

`action_executor.py` now takes `NodeInputs` directly. No change in behavior; drops ad-hoc document-id harvesting. Emits `Emission` with one or more `PortPayload`s per declared output port.

#### 4.1.3 Agent executor

`graph_builder.py:754–1300` is refactored:

1. **Prompt construction** — `build_task_prompt()` (in `port_resolution.py`) shrinks to:
   - Task title and description
   - Structured inputs as JSON blocks, one per input port:
     ```
     <input port="indexed_docs" kind="document">
     [{"document_id":"doc_123","indexing_status":"ready","workspace_id":"..."}]
     </input>
     ```
   - Short instruction: *"You must return your final answer via structured output matching the declared output ports: [...]"*.
   - No stringified upstream prose, no `context_from_dependencies`, no `workspace_context` side-channel.

2. **Tools** — only *genuine* agent tools remain (workspace search, code interpreter, connectors). No `read_port` tool.

3. **Structured output** — the LLM is invoked via `with_structured_output(emission_schema)` where `emission_schema` is a Pydantic model **synthesized at runtime from the node's declared `outputPorts`**:
   ```python
   def build_emission_schema(task: PlaybookTask) -> type[BaseModel]:
       # dynamically create a model with one field per declared output port,
       # each typed as list[PortPayload] with artifact_kind validator
   ```

4. **Validation & repair** — if structured output fails validation:
   - 1 deterministic repair attempt with a `{errors}` hint appended to the prompt.
   - On second failure: task status `failed` with `error = "emission_validation_failed"`. No silent fallback.

5. **Components** — retained as a **read-time projection** of `text`/`code` payloads for UI rendering. They are no longer a routing path.

### 4.2 gRPC protocol (`chatbot.proto`)

Additive changes only, to preserve compatibility with any external callers:

```protobuf
message PortPayload {
  string port_id = 1;
  string artifact_kind = 2;
  oneof body {
    string content = 3;
    ArtifactRef ref = 4;
    google.protobuf.Struct data = 5;
  }
  google.protobuf.Struct metadata = 6;
  string source_task_id = 7;
  string source_port_id = 8;
  google.protobuf.Timestamp produced_at = 9;
}

message PlaybookTaskRequest {
  // ... existing fields ...
  repeated PortPayload node_inputs = 30;       // NEW: resolved per-port inputs
  repeated string declared_output_ports = 31;  // NEW: contract for emission validation
}

message PlaybookTaskResult {
  // ... existing fields retained ...
  repeated PortPayload emitted_payloads = 20;  // NEW: canonical output
}
```

Legacy fields (`context_from_dependencies`, `workspace_context`, `input_files_by_port`, `components`, `artifacts`) stay in the proto during the transition window (see §7) but are deprecated with `// DEPRECATED` comments. The ADK stops reading them after phase 3.

### 4.3 NestJS backend

#### 4.3.1 `playbook-execution-graph.service.ts`

- New method `resolveNodeInputs(execution, snapshot, taskId): PortPayload[]` centralizing all upstream routing. Replaces:
  - `buildWorkspaceContextFromUpstreamArtifacts` (L99–179)
  - `buildContextFromDependencies` (find current name and inline into resolver)
  - upstream-result walking (L207–256)
- Output shape is the canonical `PortPayload[]`, grouped by `target_input_port_id` on the consumer side.

#### 4.3.2 `playbook-execution.service.ts`

- `buildGrpcRequest` (L2959–3062):
  - Populate `node_inputs` and `declared_output_ports`.
  - Keep emitting legacy fields during phase 1–2; drop them in phase 3.
- Result ingestion:
  - Read `emitted_payloads` and write to execution `taskResults[task_id].artifacts` using the same envelope shape.
  - Historical executions read through a back-compat shim that maps legacy `artifacts`/`components` to `PortPayload`.

#### 4.3.3 Persistence (`playbook-execution.schema.ts`)

- Add `artifactsByPort: Map<PortId, PortPayload[]>` to task result documents.
- Legacy `components` / `artifacts` arrays retained for already-stored executions.
- On read, a mapper produces a unified `PortPayload[]` view for consumers.

### 4.4 Frontend

- No authoring-UI change.
- Execution detail view: renders `PortPayload[]` per port. `text`/`code` payloads reuse the existing component renderer (projection). `document`/`image`/`dashboard` render via the existing artifact viewer.
- Port-level lineage view (stretch): use `source_task_id` / `source_port_id` to draw provenance edges in the result panel.

## 5. Determinism Guarantees

| Property | Mechanism |
|---|---|
| Replay from checkpoint | All inputs a node observes are materialized in `state.artifacts` before the node runs; `StateSnapshot` at the pre-node boundary is sufficient to replay. |
| Idempotent retry | The edge shim is pure; the agent prompt is a deterministic function of `NodeInputs` (LLM non-determinism is scoped to the model call itself). |
| No hidden I/O | No `read_port` tool; all data the LLM can access is visible in the recorded prompt. `tool_trace` remains the full causal log for side-effecting tools. |
| Schema-enforced outputs | `with_structured_output` guarantees the emission conforms to declared ports, or the task fails cleanly. |
| Fan-in correctness | `merge_artifacts_reducer` is associative and commutative per `(task_id, port_id)`; safe under parallel branches. |

## 6. Migration Strategy (per-execution, not per-playbook)

Migration is runtime-scoped. Playbook definitions do not change shape.

1. **Historical executions**: a read-time adapter projects stored `components`/`artifacts` to `PortPayload[]`. No backfill job.
2. **In-flight executions** at deploy time: complete on the legacy path. A version flag in the execution document (`engineVersion: 1 | 2`) selects the code path for subsequent steps.
3. **New executions**: start on `engineVersion: 2` once the feature flag is enabled (see §7).

## 7. Phased Rollout

Feature flag: `playbook.portUnification.v2` (per tenant).

**Phase 0 — Scaffolding (no behavior change)**
- Add `PortPayload`, `Emission`, schema synthesizer, `merge_artifacts_reducer`.
- Add new gRPC fields (additive). ADK reads from legacy fields only.
- Tests: type/schema round-trip.

**Phase 1 — Dual-write, legacy-read**
- Backend fills both `node_inputs` (new) and legacy fields.
- ADK still reads legacy. Emits both legacy `artifacts` and new `emitted_payloads`.
- Tests: parity check — for every executed task, assert legacy↔new projections agree.

**Phase 2 — Dual-write, new-read (behind flag)**
- Enable `playbook.portUnification.v2` in staging.
- ADK reads `node_inputs` and uses structured output for agents.
- Agents validated with emission schema.
- Tests: integration runs for representative playbooks (action-only, agent-only, mixed, fan-out, fan-in).

**Phase 3 — New-only**
- Flag enabled in prod for a pilot tenant, then globally.
- Backend stops populating legacy fields on send.
- ADK stops reading legacy fields.
- Proto fields marked `// DEPRECATED — do not read`.

**Phase 4 — Cleanup**
- Delete `context_from_dependencies` construction, `workspace_context` side-channel, component-based port routing, and legacy resolution paths.
- Proto fields removed in a major version bump.

Rollback: flipping the flag off reverts to phase 1 behavior (dual-write, legacy-read). Phase 3 is the first non-reversible transition; pilot for ≥ 1 week before global.

## 8. Testing Strategy

### 8.1 Unit

- `resolve_node_inputs` — table-driven cases: missing upstream port, fan-in from N sources, port-kind mismatch, empty upstream.
- `merge_artifacts_reducer` — associativity, idempotent re-run.
- `build_emission_schema` — generated schemas reject out-of-contract port IDs and wrong `artifact_kind`.
- Legacy↔new projection — round-trip equivalence for stored executions.

### 8.2 Integration (ADK + backend, mocked LLM)

- Action→Action: typed metadata preserved end-to-end.
- Action→Agent: `document_id` reaches the agent prompt and is cited back in its emission.
- Agent→Action: agent emission routed via port, consumed correctly as typed input.
- Fan-out: one source port to N target nodes.
- Fan-in: N source ports merged on one target input port.
- Validation failure path: repair attempt, then hard fail.

### 8.3 End-to-end (live LLM, canary playbook)

- Representative playbook exercising all three transitions above.
- Determinism smoke: same inputs + fixed seed → same emitted `PortPayload` structure (content text may drift).
- Replay: pause mid-playbook, restart from checkpoint, observe identical downstream routing.

## 9. Observability

- New span attributes per node execution: `input_ports_count`, `output_ports_count`, `emission_valid`, `repair_attempted`.
- Per-edge logging: `source_task_id`, `source_port_id`, `target_input_port_id`, payload count, artifact kinds.
- Validation failures are first-class metrics (`playbook.agent.emission_validation_failed{task_id, tenant}`).

## 10. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| LLM compliance with structured output is imperfect on complex schemas | Keep `Emission` flat; use JSON Schema with explicit `port_id` enum; single repair attempt with error hint. |
| Prompt size grows when inputs include many `data` payloads | Payloads can carry `ref` (by-reference) instead of inline `content`; ADK resolves refs lazily for genuine tool use, not for prompt injection. |
| Historical executions render differently | Read-time adapter is unit-tested for stored fixtures; any divergence surfaces as a visual regression. |
| Structured-output provider gaps (self-hosted models) | Fall back to tool-forced emission (a single `emit_result` tool with the same schema) — still deterministic because the LLM cannot *pull* inputs. |
| Schema synthesis complexity for heterogeneous ports | Cache synthesized schemas keyed by `(task_id, outputPorts hash)`; validate at playbook save time to surface issues early. |

## 11. File-Level Work Breakdown

| Area | File | Change |
|---|---|---|
| Types | `yellowstorm-adk/src/langgraph_engine/types/port_payload.py` | New |
| Types | `yellowstorm-adk/src/langgraph_engine/types/emission.py` | New |
| State | `yellowstorm-adk/src/langgraph_engine/state.py` | New reducer |
| Routing | `yellowstorm-adk/src/langgraph_engine/port_routing.py` | New `resolve_node_inputs` |
| Agent exec | `yellowstorm-adk/src/langgraph_engine/graph_builder.py` (L754–1300) | Replace prompt construction + add structured output |
| Action exec | `yellowstorm-adk/src/langgraph_engine/action_executor.py` | Consume `NodeInputs`, emit `Emission` |
| Legacy shim | `yellowstorm-adk/src/langgraph_engine/port_resolution.py` | Shrink to prompt scaffolding |
| gRPC | `YellowStorm/back/src/modules/conversation/proto/chatbot.proto` | Add `PortPayload`, `node_inputs`, `emitted_payloads` |
| Graph svc | `YellowStorm/back/src/modules/playbook/services/playbook-execution-graph.service.ts` | New `resolveNodeInputs`; collapse L99–256 |
| Exec svc | `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.ts` | Dual-write then new-only; adapter on read |
| Schema | `YellowStorm/back/src/modules/playbook/schemas/playbook-execution.schema.ts` | Add `artifactsByPort` |
| Frontend | `YellowStorm/front/src/modules/playbook/...` | Renderer consumes `PortPayload[]`; components become projection |

## 12. Acceptance Criteria

1. A playbook with the sequence `action(index) → agent(analyze) → action(delete)` roundtrips `document_id` verbatim through all three nodes — verifiable in the execution trace.
2. An agent node with two declared output ports emits exactly two validated port entries; any deviation fails the task instead of silently mis-routing.
3. `context_from_dependencies` and `workspace_context` are removed from the ADK request path in phase 3.
4. Deterministic replay from a mid-playbook checkpoint produces identical `node_inputs` for every downstream node.
5. Legacy executions (pre-flag) render in the UI without regression via the read-time adapter.

## 13. Open Questions

- Should `data` payloads carry an optional `schema_ref` (JSON Schema URI) that the agent is shown? Would let downstream agents reason about shape without parsing. Recommended yes, phase 2.
- Parallel branches writing to the same `(task_id, port_id)` — should the reducer reject or append? Current recommendation: reject (same task cannot emit twice on the same port in one run); fan-in happens on the consumer side only.
- Do we preserve `Component` emission from the LLM as a UI-only side-channel during phase 2, or drop immediately? Recommendation: keep as projection of text/code payloads — no independent routing role.
