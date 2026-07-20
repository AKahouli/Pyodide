# Worky architecture: orchestrator + tool wrapping

Worky is a parallel multi-agent orchestrator. A user message becomes a
**plan** (a DAG of steps), the plan becomes an **ADK Workflow graph**, and the
graph runs with real parallelism, human-in-the-loop pauses, and mail-reply
pauses — all resumable across process restarts because the session is durable.

Two repos, one feature:

- `yellowstorm-adk/src/companion_ai/` — the orchestrator itself (Python, Google ADK).
- `YellowStorm/back/src/modules/worky/` — the NestJS backend: HTTP/gRPC boundary,
  Mongo projections, mail webhook/polling, SSE to the client.

They talk over gRPC (`CompanionAi` service) and are kept in sync one-way
by an **ElectricSQL** read model (Postgres → NestJS consumer → Mongo → SSE).

---

## 1. The turn lifecycle (CQRS: write side vs read side)

A "turn" is one pass from user message to plan completion (or a pause). The
numbered `[worky] N.` log lines in the code trace one turn end-to-end:

```
STEP 1  RunTask receives the user's message              (companion_ai_servicer.py)
STEP 3  ack immediately, run the turn in the background   (companion_ai_servicer.py)
STEP 4  new turn, or the answer to a pending question?    (companion_ai_servicer.py)
STEP 5  planner LLM → Plan{ steps + depends_on }, or a direct reply   (service.py)
STEP 6  validate the DAG + assign parallel waves                     (service.py)
STEP 7  project plan + steps (pending) to the read model             (service.py)
STEP 8  connectors → tools, to_workflow(plan) → ADK Workflow          (service.py)
STEP 9  Runner.run_async() → map node events → live step status      (service.py)
STEP 10 derive + project the final plan/session status, post reply   (service.py)
```

**Write side** (steps 1–10): gRPC `RunTask` acks in milliseconds; the actual
turn runs as a background `asyncio.Task`. The client never blocks on it.

**Read side**: every state change (step running/completed/blocked, new chat
message) is projected into Postgres (`sessions`, `plans`, `plan_steps`,
`messages`). ElectricSQL streams those Postgres rows to the NestJS backend
(`WorkyElectricConsumerService`), which mirrors them into Mongo and re-emits
over SSE (`/worky/streams/{id}/events`). The frontend never polls gRPC — it
watches the read model.

This split is why `RunTask` (and `DeliverMailReply`) can safely run for
minutes: the caller already got its ack, and progress streams independently.

### Planner vs executors

- **Planner** (`PLANNER_INSTRUCTION` in `service.py`): one `LlmAgent`, sees the
  *whole* user request, decides CASE A (direct reply, no plan) or CASE B
  (emit `{title, goal, steps: [...]}` as strict JSON). Each step has a
  `kind`: `execute`, `ask` (pause for the user), or `await_reply` (pause for
  an email reply — always depends_on the step that sent that email).
- **Executors** (`nodes.py`): one `LlmAgent` **per step**, built by
  `make_llm_node_factory`. Deliberately **not** told the plan's `goal` or the
  other steps — only `step.description`, which the planner is required to
  write as a complete, standalone instruction. This is a hardened design
  choice, not an oversight (see §4).

### Plan → graph (`graph.py`)

`to_workflow()` turns `Step.depends_on` into ADK edges:

- no deps → edge from `START`
- 1 dep → direct edge
- ≥2 deps → routed through a `JoinNode` (a plain node with N incoming edges
  fires N times in ADK 2.3.0 — verified against the installed version — so
  real fan-in needs an explicit AND-join)
- multiple terminal steps (nothing depends on them) → joined into one sink,
  since ADK requires a single terminal output

Independent steps in the same "wave" (`scheduler.assign_waves`) run
concurrently, bounded by `max_concurrency`.

### Pausing and resuming

Three ways a step can park, all riding the same mechanism — an ADK
interrupt id stored on the session:

| kind          | who can answer it        | prefix (`hitl.py`) |
|---------------|---------------------------|---------------------|
| `ask`         | the chat user only        | `ask:`              |
| `await_reply` | only an incoming email     | `mail:`             |

`hitl.is_ask()` is the single check that keeps a chat reply from ever
resolving a mail wait, and vice versa. A session can have several steps
parked at once (one wave can raise several interrupts); each is resumable
independently via its own `interrupt_id`.

Resume paths (`resume_turn`, `continue_turn`) rebuild the **same** Workflow
from the plan stored in the read model (same step ids + `depends_on` ⇒ same
node names + edges), then call `Runner.run_async` again. ADK replays already-
completed nodes from the durable session and only re-runs the parked one —
this is what makes a mail reply arriving hours later, or a process restart,
transparent to the plan.

### Mail-reply routing (why it can't cross-wire)

1. At plan-projection time (`_register_mail_waits`), every `await_reply` step
   gets an opaque random **token** (`mail_token.mint()`), registered in the
   read model *before* any mail is sent — the row exists unbound because the
   step that sends the mail runs before the step that waits on it parks.
2. `_mail_stamping()` links each send step to the token of the step waiting
   on its reply, using the plan's own edge (`await_reply` step's
   `depends_on`). It wraps that step's `send_email` tool
   (`nodes.stamp_send_email_tool`) so the token is stamped into the outbound
   subject **and** a hidden HTML span in the body — deterministically, never
   exposed to the LLM (an instruction like "include this token" fails open:
   the one time the model omits it, the step waits forever).
3. When a reply arrives — pushed via a Graph webhook or picked up by a 5-min
   catch-up sweep — the backend extracts the token (regex `YW-[A-Za-z0-9_-]{16,}`)
   and calls the single gRPC entrypoint `DeliverMailReply`.
4. `DeliverMailReply` claims the token atomically (`claim_mail_wait`) — a
   second delivery of the same token (Graph retries on anything it thinks
   failed) is a silent no-op, not a second resume — then calls the *same*
   `resume_turn` the chat path uses, targeted at that exact `interrupt_id`.

Because the token is minted once per waiting step and claimed exactly once,
two concurrent `await_reply` steps in the same plan (e.g. waiting on two
different people) can never resolve each other's wait.

---

## 2. Tool wrapping — how a "tool" gets to an executor's `LlmAgent`

Executors don't get tools built in; they get **connector bindings**
materialized into ADK tools fresh on every turn. Three layers:

### Layer 1 — connector bindings (NestJS → gRPC)

The backend resolves which MCP connectors the user has enabled
(`WorkyTurnContextService.resolveConnectors`, slugs: `code-interpreter`,
`linkup`, `microsoft365`) and sends them as `ConnectorBinding` proto messages
on every `RunTask`/`DeliverMailReply` call: server URL, transport type, auth
headers/env, and the list of `actions` (name + description + JSON parameter
schema) that connector exposes.

`companion_ai_servicer.py::_connectors_to_dicts` turns that proto into plain
dicts (parsing `mcp_server_config_json` and each action's
`parameter_schema_json`).

### Layer 2 — bindings → ADK `FunctionTool`s (`connector_tools.py`)

`create_connector_tools(bindings, context)` is the factory that, for every
`(connector, action)` pair, synthesizes one Python async function **at
runtime**:

- Tool name: `{connector_slug}_{action_key}` (e.g. `linkup_web_search`,
  `microsoft365_send_email`) — this naming convention is how
  `nodes.is_send_email_tool()` finds "the" send-email tool regardless of
  which connector provides it (`name.endswith("_send_email")`).
- JSON schema + Python `inspect.Signature` built dynamically from the
  connector's declared `parameter_schema`, so the LLM sees a proper typed
  signature instead of a generic blob.
- The function body always funnels through **`call_mcp_tool()`**
  (`flow_engine/mcp/__init__.py`) — a one-shot MCP connection (streamable
  HTTP/SSE/stdio), call, close. Two important properties:
  - it catches *all* exceptions and returns an **error string**, never
    raises — a failed tool call can't crash a node or force any special LLM
    behavior; the executor just sees "Error: ...".
  - workspace/brain-id binding, image buffering for the model, and citation
    source registration are layered on the response before it goes back to
    the LLM (all in `connector_tools.py`).
- Each function is wrapped in `SearchToolADK` (`smart_rag/tools/search/tools.py`),
  a thin `FunctionTool` subclass that overrides `_get_declaration()` to hand
  ADK a **pre-built** `FunctionDeclaration` instead of introspecting the
  function — necessary because the schema comes from the connector, not from
  Python type hints alone.

### Layer 3 — per-step tool assembly (`service.py::_tools_for`, `nodes.py`)

`OrchestratorService._tools_for()` builds the **shared** tool list once per
turn: `create_connector_tools(...)` plus, per connector, a fire-and-forget
`schedule_*_task` tool (`long_running.make_schedule_tool`) for long-running
actions — calling it records the task handle via `mcp_tasks.enqueue` so a
background poller can pick up the result later, instead of the executor
blocking on it.

Every step gets the **same** shared tool list — deliberately not
tool-restricted per step (rejected fix, see §4). What *can* differ per step
is the tool's **behavior**, via `tools_for_step` in `make_llm_node_factory`:
`_mail_stamping()` swaps in a stamped `send_email` for exactly the step
feeding an `await_reply`, leaving every other step's tools untouched.

`nodes.stamp_send_email_tool()` shows the wrapping pattern used throughout:
wrap the original async function, preserve `__name__`/`__signature__`/
`__annotations__` so the LLM-facing contract is identical, inject
side-effecting behavior (stamping a token) invisibly around the real call.

---

## 3. NestJS side: connectors, mail delivery, read-model sync

```
WorkyMessageController          — HTTP boundary (sendMessage/resumeTurn/stop/pause)
WorkyTurnContextService         — resolveManagerModel() / resolveConnectors(userId)
                                   shared by the controller AND both mail-delivery paths
WorkyOrchestratorGrpcClientService — thin gRPC client (RunTask, DeliverMailReply, ...)
WorkyMailWebhookService         — Graph push notification → extract token → DeliverMailReply
WorkyMailCatchupService         — 5-min poll sweep, same extract-token → DeliverMailReply
WorkyMailSubscriptionService    — creates/renews the Graph subscription (push) or
                                   marks poll-only when no public webhook URL is configured
WorkyElectricConsumerService    — Postgres (Electric) → Mongo mirror → SSE re-emit
```

`WorkyTurnContextService` exists because **both** entrypoints that can
resume a plan — a chat message and a mail reply — need the same connectors
and model resolved the same way. Before it existed, the mail-delivery paths
called `deliverMailReply` with no connectors/model at all, so any step that
had to run fresh during a mail-triggered resume silently got **zero tools**:
it would report "completed" without ever calling the tool it needed (e.g.
forwarding a report by email) — see the commit `fix(worky/back): resolve
real connectors and model when a mail reply resumes a plan`.

---

## 4. Two hardened design decisions (production bugs, not hypotheticals)

**Executors never see the plan's `goal` or each other's steps.**
`EXECUTOR_INSTRUCTION` only ever receives `step.description`. Threading the
plan-wide goal into every executor gave every step both the motive ("the
overall goal needs an email sent") and the means (every step shares the same
toolset) to reach for a tool that was another step's job — proven in
production as a duplicate, unstamped `send_email` fired by a step whose own
instruction never mentioned mail.

**The workflow's trigger message is never the user's real text.**
`plan_turn` drives `Runner.run_async` with a benign placeholder
(`"run the plan"`), not the actual request. Reason (verified against the
installed `google-adk` source, `flows/llm_flows/contents.py`): an ADK session
event with no `branch` is visible to **every** node in the graph
unconditionally, regardless of that node's own instruction. The very first
triggering message predates any node/branch, so passing the real text made
every step's LLM context include the whole original request — a step told
only "search Apple news" could still see "...email Rabeb... search Tesla AND
Apple..." and act on part of it. `continue_turn`/`resume_turn` already used
a benign trigger for the same reason; `plan_turn` was the last path fixed.

A previously considered fix — stripping `send_email` from every step not
linked to an `await_reply` — was rejected: a plan can legitimately contain
more than one independent `send_email` step, and blanket-stripping breaks
that case. The two fixes above address the actual leak channels instead of
narrowing what any step is allowed to hold.
