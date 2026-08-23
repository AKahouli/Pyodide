# YellowStorm — Remediation Change Spec

Detailed plan for the **YellowStorm** changes required by the
`YELLOWMIND_CUBESANDBOX_MCP_MANUS_REMEDIATION_PLAN`. YellowStorm is **Repository C (Conversation, §42)**
and **Repository D (Playbook, §43)**. This spec is written against the contract the Runtime Coordinator
(`sandbox-manager`) now enforces — those endpoints, headers, and formats are implemented and tested; the
work below is what YellowStorm must do to speak that contract and to own the product-level file semantics.

> Written from the Coordinator side; the YellowStorm code is in a separate repo. Component names
> (`ConversationV2Session.systemWorkspaceId`, `WorkspaceDocument`, `FlowExecution`,
> `FlowTaskResult.artifacts`, `documents_by_port`, `binding_workspace_ids`, typed output ports) are the
> plan's; confirm exact call sites in the YellowStorm codebase during implementation.

---

## 0. Responsibility boundary — who does what

The runtime call path is:

```
YellowStorm  →  ADK  →  MCP connector  →  MCP Manus  →  Runtime Coordinator (sandbox-manager)  →  Cube
```

| Concern | Owner | Notes |
|---------|-------|-------|
| Originate the canonical runtime context (scopeType/scopeId/laneId/user) | **YellowStorm** | §7 — starts here |
| Forward context as `x-sandbox-*` headers + call Coordinator/SDK | MCP Manus (Repo B) | not YellowStorm |
| Sandbox ownership / leases / quotas / admission | Coordinator | **done** |
| Product lifecycle (session/execution), auth, agent/connector inheritance | **YellowStorm** | unchanged model |
| Register generated files as WorkspaceDocument / FlowTaskResult.artifacts | **YellowStorm** | §25-27, §42/§43 |
| ID/scope-based downloads (signed URLs) | **YellowStorm** | §28 |
| Input resolution → Input Manifest | **YellowStorm** | §10, §43 |

**YellowStorm does NOT** send headers to the Coordinator directly (MCP Manus does). YellowStorm's job is to
**produce the context values** and pass them into the agent/connector invocation, plus own the application
file model on the way back out.

---

## 1. The contract YellowStorm must satisfy

These are fixed by the Coordinator implementation; YellowStorm must produce values in exactly these shapes.

### 1.1 Scope identity (P0 invariant — §6)
Ownership is `(scopeId, laneId)`, never user_id. Formats:

```
Conversation:  scopeType = "conversation"
               scopeId   = "conversation:<YellowStorm-session-id>"   # the product session id, NOT an internal AI id
               laneId    = "main"

Playbook:      scopeType = "playbook"
               scopeId   = "playbook:<execution-id>"
               laneId    = "main"                                    # Mode A default
                         | "node:<node-id>:iter:<n>:attempt:<a>"     # parallel CI (Mode B/C)
                         | "node:<node-id>:iter:<n>:child:<child-id>"# temporary child agents
```

The Coordinator derives `leaseId = sha256(scopeId\0laneId)[:16]`. Same scope+lane ⇒ same sandbox; different
scope ⇒ different sandbox. **This is why two Conversations for the same user no longer collide.**

### 1.2 Values MCP Manus will forward as headers (YellowStorm supplies them)
```
x-user-id, x-sandbox-scope-type, x-sandbox-scope-id, x-sandbox-lane-id, x-node-id?, x-node-iteration?
```
Missing/invalid scope ⇒ Coordinator returns **422**; wrong scope for a sandbox ⇒ **403**. So YellowStorm
must set these on every runtime-bearing agent turn, or Code Interpreter calls will fail.

### 1.3 Publication response YellowStorm receives (to register)
`publish_artifact(path)` (agent tool → Coordinator) returns:
```json
{ "status":"success", "filename":"report.xlsx", "leaseId":"lease-…",
  "scopeType":"conversation|playbook", "scopeId":"…", "laneId":"…",
  "cephPath":"<user>/system_<storageKey>/report.xlsx", "published":true }
```
YellowStorm branches on `scopeType` to run the correct application adapter (§27).

---

## 2. Canonical runtime context origination (§7, §31 P0.1) — both repos

**Change:** introduce one explicit `RuntimeContext` object created at the point YellowStorm invokes an
agent that has the MCP Manus connector, and thread it through ADK → connector.

```jsonc
{
  "userId": "user-1",
  "scopeType": "conversation" | "playbook",
  "scopeId": "conversation:<sessionId>" | "playbook:<executionId>",
  "laneId": "main" | "node:<id>:iter:<n>:…",
  // tracing / adapter routing:
  "conversationId": "<sessionId>" | null,
  "executionId": "<executionId>" | null,
  "nodeId": "<nodeId>" | null,
  "iteration": 0,
  "agentId": "agent-10",
  "workspaceIds": ["ws-1"],
  "fileRefs": []
}
```

**Rule (§7):** do NOT use implicit precedence like "conversationId if present else executionId" to pick
ownership. The scope is explicit and set by the caller (Conversation flow vs Playbook node runtime).

---

## 3. Repository C — Conversation (§42)

Preserve the current Conversation file model (`systemWorkspaceId`, WorkspaceDocument, Files panel). Only
add scope propagation and swap publication/download to be ID/scope-based.

### P0

**C-1. Send scope context on every Code Interpreter turn.**
- Where: the ConversationV2 agent-invocation path that attaches the MCP Manus connector.
- Set `scopeType="conversation"`, `scopeId="conversation:" + session.id`, `laneId="main"`, `userId`.
- Use the **YellowStorm session id** (`ConversationV2Session`), not an internal AI-service id (§6.1).

**C-2. Keep `systemWorkspaceId` exactly as is.** No schema change; it remains the home for uploaded +
AI-generated Conversation files (§8).

**C-3. Publication adapter: runtime file → WorkspaceDocument (§8.3, §25).**
On a `publish_artifact` result with `scopeType=conversation`:
1. Persist/commit the runtime file into Conversation system storage (the Coordinator has already copied it
   to `cephPath`).
2. Register a `WorkspaceDocument` row in `systemWorkspaceId` (filename, mimeType, size, source=ai-generated,
   link to `cephPath`/objectKey).
3. Attach the resulting `documentId` to the assistant message.
4. Files panel refreshes as today (no UI redesign).
- Return logical metadata to the assistant, not a raw Ceph path (§25): `{filename, mimeType, documentId, workspaceId, published}`.

**C-4. Downloads become ID/scope-based (§28).**
- `documentId → YellowStorm authorization → signed URL`. Stop handing the frontend permanent raw Ceph
  object keys. Existing Files-panel download switches to the signed-URL endpoint.

**C-5. Lease lifecycle tie-in (§36).**
- Store the `leaseId` returned by acquire (via MCP) on the session.
- On session terminal/close, call Coordinator `POST /runtime/leases/{leaseId}/release`. (Do not rely on MCP
  shutdown to destroy — MCP lifecycle is independent, §31 P0.7. The Coordinator's idle-expiry is a backstop.)

### P1

**C-6. Runtime input update when a file/workspace is added mid-session (§29).**
- User uploads a document while a sandbox already exists → keep the current
  `Browser → Workspace API → Ceph S3 → WorkspaceDocument` path (do NOT route uploads through MCP).
- Then emit a **runtime input update** (new document/workspace id) to the Coordinator/MCP so the existing
  sandbox can read it — **do not recreate the sandbox**. With live storage projection the file appears
  automatically; otherwise only the new object is materialized.

**C-7. Migrate raw path references → document/workspace IDs** in agent/tool context (§42 P1).

### Conversation acceptance (maps to §48)
- **C1**: two simultaneous Conversations, same user → no VM/file cross-talk (Coordinator guarantees this once
  distinct `scopeId`s are sent — C-1 is the enabling change).
- **C2**: upload `budget.xlsx` after the first CI call → next call sees it without VM recreation (C-6).
- **C3**: generate `report.docx` → appears as WorkspaceDocument in the system workspace, Files panel shows it,
  download works (C-3, C-4).

---

## 4. Repository D — Playbook (§43)

Preserve the inherited-connector model, typed artifact ports, `FlowTaskResult.artifacts`. Change identity
propagation, input transport, and publication routing.

### P0

**D-1. Send scope context per node runtime.**
- `scopeType="playbook"`, `scopeId="playbook:" + execution.id`, `userId`.
- Keep the MCP Manus connector inherited from the assigned agent (do not bypass it).

**D-2. Derive `laneId` from node/iteration/child context (§6.2).**
- Default Mode A: `laneId="main"` for all nodes of the execution → they share one sandbox (serialized by the
  Coordinator, Phase 5).
- Parallel CI (Mode B/C, later): `node:<nodeId>:iter:<iteration>:attempt:<attempt>`; temporary children:
  `node:<nodeId>:iter:<iteration>:child:<childId>`.

**D-3. Emit generated files as `FlowTaskResult.artifacts` (§26).**
On `publish_artifact` with `scopeType=playbook`, register:
```json
{ "artifactId":"art-123", "filename":"report.xlsx",
  "relativePath":"artifacts/<nodeId>/report.xlsx", "artifactKind":"data", "outputPortId":"result" }
```
Persist into `FlowTaskResult.artifacts`; keep the existing typed artifact→output-port routing. Do **not**
force Playbook outputs into Conversation `WorkspaceDocument` semantics (§9, §26).

**D-4. Enforce artifact commit before dependent-node consumption (§23, §24).**
- A node writes to its lane dir, then commits (atomic rename/copy) into `run/artifacts/<nodeId>/…` before it
  is considered artifact-complete. Downstream nodes only read committed artifacts. This is the structure that
  avoids parallel basename collisions (the per-node dir).
- YellowStorm's node-completion gate must wait for the commit + `FlowTaskResult.artifacts` update before
  scheduling dependents.

**D-5. Runtime storage namespace.** The execution-wide shared runtime folder stays conceptually
`system_<execution-id>`; every CI call in the execution must reach committed execution files. This is a
runtime namespace, **not** a Conversation `systemWorkspaceId` (§9.1). No mandatory Playbook systemWorkspaceId.

### P1

**D-6. Migrate input propagation → Input Manifest (§10) — see §7 below.** Replace raw physical path headers
with a logical manifest resolved by the Coordinator after authorization.

**D-7. Code Interpreter concurrency mode.** Start with Mode A serialization (already enforced by the
Coordinator). When enabling parallel lanes, produce distinct `laneId`s per D-2 and set the Coordinator's
`CODE_INTERPRETER_PARALLELISM` accordingly (gated on the §46 lane-executor spike).

**D-8. Runtime input updates after HITL / new file selection (§30).** On a HITL attach, update the Input
Manifest → Coordinator updates projection/materialization → subsequent CI call sees it. Do not assume the
sandbox created at execution start has a frozen file set.

**D-9. Use artifactIds / relative runtime paths in downstream bindings** rather than raw object keys.

### Playbook acceptance (maps to §48)
- **P1** sequential artifacts: Node A `clean.csv` → Node B reads A's committed file (D-4, D-5).
- **P2** parallel same VM: A and B both write `result.csv` → `artifacts/node-A/…` and `artifacts/node-B/…`,
  no collision (D-3, D-4).
- **P3** temporary child agents: each child gets a distinct lane (D-2).
- **P4** multi-VM: two lanes escalate to separate microVMs, both see execution-wide committed artifacts.
- **P5** new file during HITL: pause → add doc → resume → downstream CI sees it (D-8).

---

## 5. Publication mapping (§25-27) — one primitive, two adapters

MCP Manus exposes a single `publish_artifact(path)`; the Coordinator returns scope metadata; **YellowStorm
runs the scope-specific adapter**:

```
scopeType == "conversation"  → register WorkspaceDocument in systemWorkspaceId  → attach documentId to message
scopeType == "playbook"      → register FlowTaskResult.artifacts entry          → route to typed output port
```

Return **logical** metadata to the model/UI (documentId or artifactId), never only a raw Ceph path.

---

## 6. Download architecture (§28) — both repos

```
Conversation:  documentId  → YellowStorm authz → signed URL
Playbook:      artifactId / executionId → YellowStorm authz → signed URL
```

Add (or reuse) a signed-URL endpoint; the frontend never holds permanent raw Ceph object keys. This is a
YellowStorm-owned security boundary.

---

## 7. Input Manifest (§10) — Playbook first, Conversation optional

Replace growing dependence on physical path headers with a logical manifest the Coordinator resolves after
authorization.

```json
{
  "manifestId": "manifest-123",
  "scopeId": "playbook:E42",
  "entries": [
    { "type":"document",  "workspaceId":"ws-A", "documentId":"doc-1", "displayName":"sales.xlsx", "access":"read" },
    { "type":"workspace", "workspaceId":"ws-B", "access":"read" }
  ]
}
```

- YellowStorm builds the manifest from the node's already-resolved refs (`documents_by_port`,
  `binding_workspace_ids`, workspace/file context) — the logical resolution model is unchanged; only the
  **final transport** changes (logical ref → manifest → authorized runtime projection).
- Long term prefer an `x-sandbox-input-manifest-id` handle over large physical-path headers.
- Authorization stays in YellowStorm; the Coordinator projects only the authorized set to
  `/mnt/yellowmind/inputs/...` (read-only where possible, §8.2/§11.1).

---

## 8. Data-model / persistence changes in YellowStorm

| Add | On | Purpose |
|-----|----|---------|
| `runtimeLeaseId` | ConversationV2Session, FlowExecution (or node runtime) | heartbeat/release; recompute-able from scope+lane but store for convenience |
| artifact link | WorkspaceDocument (Conversation) / FlowTaskResult.artifacts (Playbook) | map `documentId`/`artifactId` ↔ `cephPath`/objectKey ↔ scope, for signed-URL download |
| `inputManifestId` (P1) | node runtime | logical input handle |

No change to `systemWorkspaceId`, typed ports, or the artifact-kind model.

---

## 9. Sequencing & dependencies

The Coordinator side is done; YellowStorm is now the critical path for the end-to-end P0.

1. **Phase 1 coordination (breaking):** the Coordinator already **requires** scope headers and a bearer
   token on runtime routes. Until MCP Manus forwards them AND YellowStorm supplies the values (C-1/D-1),
   Code Interpreter calls 422/403. Ship C-1/D-1 + MCP header forwarding together.
2. **Phase 4 publication (C-3/D-3):** independent of the SDK/Volume spikes; can land now against the
   existing `publish_artifact` response.
3. **Downloads (C-4/§6):** with Phase 4.
4. **Runtime input updates (C-6/D-8) + Input Manifest (D-6):** P1, after the above.
5. **Concurrency modes (D-7):** gated on the Coordinator's §46 lane-executor spike; Mode A works today.

Cross-repo ordering: **MCP Manus header forwarding must land with YellowStorm C-1/D-1** — coordinate the cut.

---

## 10. Acceptance / regression matrix (§48)

Owned or co-owned by YellowStorm:
- C1 two Conversations no cross-talk · C2 mid-session upload visible · C3 generated file → WorkspaceDocument + download
- P1 sequential artifact hand-off · P2 parallel per-node artifacts · P3 child-agent lanes · P4 multi-VM shared artifacts · P5 HITL new file
- M1 mixed load (25 users): per-user quotas, no cross-talk, artifact correctness, restart-safe (the
  Coordinator enforces quotas/admission; YellowStorm must set correct scope so isolation holds).

---

## 11. Open questions for the YellowStorm team
1. Exact call site where the ConversationV2 / Playbook-node agent invocation attaches the MCP connector —
   that is where `RuntimeContext` must be injected.
2. Is there an existing signed-URL mechanism for WorkspaceDocument to reuse for §28, or is it net-new?
3. Storage projection (Runbook B, §45): if live CephFS/Volume projection exists, C-6/D-8 become "no-op,
   file appears automatically"; if not, YellowStorm must trigger selective materialization of the new object.
4. Playbook node-completion gate: where to insert the "artifact committed" wait (D-4) relative to the
   current `FlowTaskResult` finalization.
