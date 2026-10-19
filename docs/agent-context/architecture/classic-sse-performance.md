# Classic distributed SSE measurement gate (PR-06)

## Scope and current status

Measurement-first work follows [ADR-0027](../decisions/ADR-0027-classic-conversation-durable-sse.md)
(proposed, existing named table approval). The gateway retains 200 ms per-connection
polling, 25 ms batching, the lock-before-identity commit order, existing retention,
recipient/current-membership predicates, bounded overflow markers, and 30-second
canonical reconciliation. No optimization or fleet-wide SSE admission is introduced.
The existing replay integration's 10/30 synthetic recipients are correctness tests,
not authenticated model-load qualification.

**Not release-qualified.** Local isolated-stack preparation and reuse of only the
existing model-provider connection are user-approved. The new local bootstrap now
starts two actual backends, dedicated ADK/Redis and provisions 30 new identities
with real login sessions and owned empty conversations; opposite-replica reads
passed. Initial model-send trials returned `503 / ERR_1417` (AI unavailable).
A direct grpc-js probe proved Node25 rejects IP-literal TLS SNI. Setting the
isolated client's existing server-name override to the generated certificate's
`localhost` SAN fixed channel readiness without relaxing TLS. The next trial
reached gRPC but failed validation because isolated `QDRANT_COLLECTION_NAME=None`
was explicitly passed into a required internal string. Supplying the schema's
`default` name in the harness fixed that without a live collection or validation
bypass. A single turn then completed (201, 31 chunks, 54 output tokens), followed
by all six HTTP scenarios and one browser smoke below. Baseline, full provider
overlap, full browser matrix and recovery qualification remain outstanding.
Do not run outage/kill experiments on the developer's live stack.

## Measurement surfaces

`StreamGatewayService` keeps fixed-cardinality, fixed-bucket cumulative measurements
and emits registered `conversation.sse.measurement` SDK events every 30 seconds.
Operations: `poll`, `lock`, `flush`, `cleanup`, `queue_commit`; `count` is the sample
count, `duration_ms` is the sum, and `detail` is the JSON array of **disjoint** bucket
counts. Upper bounds in milliseconds are `1,5,10,25,50,100,200,500,1000,2000,5000,10000,+Inf`.
Percentiles are bucket upper-bound estimates; +Inf must stay unbounded, never 10000.
Subtract cumulative snapshots per process instance; never sum successive snapshots.
Process restarts reset counters. SDK delivery is best-effort, so collect both
replicas' logs and explicitly report missing/reset snapshots. Deploy a freshly
staged observability SDK containing the new registry event; an old installed SDK
does not gain events merely because the source registry changed.

Counters include accepted/rejected connections, cursor-bearing registrations
(`resumed`, not proof of replay), poll/flush errors, delivered/withheld rows,
resync notices, overflow, dropped queued/incoming entries and global markers.
Gauges are current connections, pending event/byte depth and backend RSS bytes;
backend user/system CPU milliseconds are cumulative process counters. `connection_ms` is
the integrated active-connection duration: `delta poll count / (delta connection_ms / 1000)`
gives polls/sec/connection. This accounts for connections opening/closing between
snapshots. Poll duration includes pool wait/query/result handling; lock duration
includes the advisory-lock query round trip, not pure server lock wait. Flush
includes transaction/pool/commit; queue-to-commit includes batch scheduling. Cleanup
duration covers the three existing deletes. No payload or identity metric labels.
These logs are not a new Prometheus scrape endpoint; existing metrics file discovery
in `infra/observability/metrics/prometheus.yml` remains deployment-owned.

Existing latency envelopes provide backend preparation/forwarding and ADK
pre-provider boundaries. The HTTP harness measures first **model** envelope TTFT
and its backend-emission-to-driver-receipt delta (cross-host clocks must be aligned).
It does not substitute this for all-event p95 or browser first paint. Existing
frontend paint reporting and browser `PerformanceObserver` long-task capture must
be collected in a separate browser workload at the same user/tab topology.

## Reproducible HTTP workload

`scripts/pr06-local-stack.mjs --check` validates dedicated migrated PG55526 and
backend artifacts/free ports. `--list-models` lists only identifiers from the
authorized model provider. `--start-stack --python ABSOLUTE_META_PYTHON --model MODEL`
creates a run-owned working directory under ignored `.tmp/pr06-local-UUID`,
backends3301/3302, ADK8006/50056 with new TLS/API credentials, an owned Redis56386
container from an already installed image, and the 30 real auth fixtures. It reads
only allowlisted provider fields from local environment files, with atomic URL/key
selection. No live user/conversation/connector/auth rows are copied. Python uses
`ENVIRONMENT=prod` to avoid loading the project's `.env`; backend cwd remains
env-free with only copied static protobuf assets. The async ADK database URL uses
`postgresql+asyncpg`; neither that URL correction nor cwd asset staging changes
production code. Ownership/log references are non-secret; tokens and seed inputs
are private local files and must never be pasted into reports. Ctrl+C the supervisor
performs owned-child/exact-container cleanup; dedicated PG/fixture cleanup stays
with the run owner. Backend/gRPC wildcard binds still require local network isolation.
Acquisition-cancellation races have focused regressions and passed required review;
an end-to-end shutdown exercise remains outstanding.

`node scripts/benchmark-classic-conversation-sse.mjs CONFIG OUTPUT --validate`
validates without network activity. `--run` opens authenticated HTTP SSE streams,
waits for all connection frames, then sends real message requests concurrently.
Output uses exclusive creation to avoid overwriting a prior run; its parent must
already exist. Access tokens are supplied via environment references, never JSON
values. Use fresh, exclusively owned conversations: unrelated traffic invalidates
recipient-isolation observations. Configuration shape:

```json
{
  "isolated": true,
  "users": 10,
  "tabs": 2,
  "replicas": ["http://127.0.0.1:3301/api/v1", "http://127.0.0.1:3302/api/v1"],
  "identities": [
    {"userId": "<24-hex fixture user>", "conversationId": "<24-hex owned conversation>", "tokenEnv": "PR06_USER_01_TOKEN"}
  ],
  "prompts": ["<pinned representative generation prompt>"],
  "model": "<model/provider/version/temperature/seed>",
  "dataset": "<fixture revision and size>",
  "hardware": "<backend/PG/ADK CPU,RAM,storage and limits>",
  "deployment": "<two replica identities/config digest and ADK endpoint>",
  "baselineSha": "<baseline commit>",
  "deadlineMs": 180000
}
```

Supply exactly 10 or 30 distinct authenticated identities/conversations/token
references; the example identity array is intentionally incomplete. Tokens must
remain valid through the deadline plus 30 seconds. The real endpoint authenticates
each token; decoded JWT claims are only a preflight consistency check. Direct
replica URLs avoid a load balancer masking routing; independently verify that they
are actually different backend instances. Configure agents/models in those owned
conversations before the run; the harness does not claim metadata proves routing.

Run each of `10/30 users × 1/2/5 tabs` on baseline and measured builds, with the same
prompts/model/data/settings and a fresh conversation cohort. Record warmup and at
least three measured repetitions. The report pins SHA, workload metadata, prompt
digest, driver hardware and latency distributions without saving prompt/response
content or tokens. Start/terminal SSE lifetimes establish **observed stream overlap**,
not concurrent provider execution. Collect ADK/provider execution intervals to prove
genuine model overlap. Output-token usage plus chunks is necessary but not sufficient
model provenance. `transportPass` only checks the harness's transport observations;
`releaseQualified` remains false until the external evidence is reviewed.

`node scripts/benchmark-classic-conversation-sse.mjs --compare BASELINE MEASURED OUTPUT`
checks identical user/tab/model/data/hardware/prompt metadata and the baseline SHA,
then reports median/p95 TTFT ratios against the provisional 1.10 limit. A failed
transport observation or ratio returns nonzero. This is a TTFT-only comparison,
not a release gate; `sourceDirty` in each workload report identifies an uncommitted
preview, which cannot replace clean pinned-SHA qualification.

Unfinished accepted turns are stopped via their existing authenticated stop route
using separate five-second cleanup signals. Missing turn IDs/failed stop requests
are explicit unresolved cleanup: inspect/stop those owned turns before another run.
The initial harness fails on disconnect; it does **not** qualify reconnect/replay or
chaos recovery. Those scenarios require a reconnect-capable browser/workload driver
and canonical persisted-message reconciliation, still outstanding.

## PostgreSQL profile and failure matrix

`node scripts/profile-classic-conversation-sse.mjs RECIPIENT CURSOR OUTPUT`
uses only explicit loopback `POSTGRES_HOST`, `POSTGRES_TEST_DB` different from
`POSTGRES_DB`, and `POSTGRES_PORT/USER/PASSWORD`. It opens a read-only transaction,
profiles the authorized poll with `EXPLAIN (ANALYZE, BUFFERS)`, and only **plans**
retention deletes. This avoids deleting data during inspection. It records index
usage, relation/expired-row/global-marker counts, PG connection and wait-state
snapshots; it never prints raw SQL failures or credentials. Defaults mirror
120000 ms TTL/200 retained events; other deployments must pin/profile their actual
values. Capture before/during/after load, including cold/retained/stale cursors.
The copied poll SQL must be reviewed alongside future gateway predicate changes.
Use an external host/container collector for CPU/RSS/PG CPU and sustained time
series. A tiny fixture's query plan is not capacity evidence. Never acquire the
global advisory lock merely to measure it; use gateway timing plus server waits.

On the dedicated stack, capture start/end timestamps and recovery for PG outages
of 3 and 10 seconds, graceful replica stop and forced replica kill, including a
kill before a pending batch commits. Verify recipient isolation, ordered durable
cursor replay, global-marker canonical resync and ≤30-second healthy gap recovery.
Compare canonical durable messages and per-tab cursor/event observations after
reconnect. Neither this harness nor this document claims those scenarios passed.

Provisional gates: zero lost/foreign events; bounded queue/PG growth; no crash or
forced restart under healthy load; healthy event-emission-to-delivery p95 <500 ms;
median/p95 TTFT deterioration ≤10% versus the identical pinned baseline. If the
baseline fails, record it and ratify a realistic gate explicitly. Only measured
failure justifies multiplexing, NOTIFY wakeups, adaptive idle polling or moving
cleanup. Durable PG replay/order/security and bounded fallback remain mandatory.

## Focused verification (2026-10-19)

Gateway/measurement unit tests: 14 passing; real isolated PG distributed tests:
10 passing; benchmark parser/lifecycle/baseline/envelope/uncertain-send tests: 14
passing; bootstrap acquisition-race tests: two passing. Shared SDK checks:
19 TypeScript and 15 Python tests passing. Production `tsconfig.build.json`
typecheck and backend build pass. Read-only profiler successfully ran against the
dedicated migrated loopback PostgreSQL (`.tmp/pr06-profile-20261019.json`); its tiny
fixture is smoke evidence only. Required scoped review passed after correcting
unfinished-generation cleanup, mandatory durable IDs and misleading model-overlap
claims. The subsequent CPU/RSS, start-time provenance and baseline-comparison
additions also passed required scoped review with no critical/major findings.
Root observability policy check fails on eight unchanged MCP diagnostics;
the generic backend `tsc --noEmit` also includes unrelated template/contract errors.
Neither failure is recorded as a passing gate. Real/browser/recovery performance
qualification remains incomplete; the following preview evidence is not a release gate.

## Local preview matrix and browser smoke (2026-10-19)

Two actual native backend replicas, dedicated TLS ADK/Redis/PG, `gpt-5.4-mini`,
30 generated real login identities, fresh empty conversation per scenario and
one identical short sky-explanation prompt. Driver: Windows, Node25.5.0, 16 logical
CPUs, approximately 32 GB RAM shared by components. This is one measured repetition
on an uncommitted measured prototype (`66501b797` plus changes later committed as
`522a1d326`, `sourceDirty:true`), not a clean pinned baseline or a ratified realistic
mixed workload. Subsequent canonical packaging does not retroactively make either
old SHA reproducibly stage its committed SDK hash. The user approved a separate
packaging fix commit and an explicitly labelled packaging-only baseline overlay,
recording its original source SHA, packaging patch and artifact hash. The pristine
baseline failure remains recorded, not reclassified as success. The SDK staging contract
and evidence are recorded in the [logging contract](../../observability/logging-contract.md).

| Users | Tabs/user | TTFT median (ms) | TTFT p95 (ms) | First-model emission→HTTP receipt p95 (ms) |
| --- | --- | --- | --- | --- |
| 10 | 1 | 1668 | 1705 | 218 |
| 10 | 2 | 1471 | 1704 | 163 |
| 10 | 5 | 1432 | 1631 | 232 |
| 30 | 1 | 3629 | 4643 | 221 |
| 30 | 2 | 3386 | 4569 | 231 |
| 30 | 5 | 4389 | 4954 | 228 |

All six completed every tab's real generation with positive output-token usage;
no foreign, reordered or duplicate **observed** turn events, no unresolved cleanup
or tab-cursor mismatch. This does not prove zero lost persisted events. Every
initial tab also observed one resync marker; that behavior is recorded, not hidden
as a clean replay pass. Other already-authorized conversations legitimately replay
on the actor-wide pipe: initial matrix attempts misclassified that history. The
wrapper now discovers actor-visible fixture history and independently authorizes
every additional ID before excluding it from foreign counts; those events are
counted separately and unknown IDs still fail. A forged-allowlist regression fails
before streaming. The HTTP parser similarly matches the existing classic browser
envelope rather than assuming native `event:` headers.

`scripts/benchmark-classic-conversation-sse-matrix.mjs RUN NEW_OUTPUT_DIR` creates
the six fresh cohorts and exclusive reports beneath the isolated run directory.
Raw preview reports: `.tmp/pr06-local-dd81d4ee-2339-4dc8-9851-b204eff45f88/matrix-fresh-03/`;
safe aggregate `.tmp/pr06-preview-matrix03-summary.json`; post-load read-only profile
`.tmp/pr06-profile-matrix03.json`. Latest gateway resource snapshots are cumulative
across bootstrap and all previews, not per-scenario resource rates. Partial
quality-ok ADK adapter intervals yielded peaks 8/7/7/18/13/10 respectively; neither
partial coverage nor adapter invocation proves 30 simultaneous external provider
executions. Baseline ≤10% comparison is therefore still unqualified, and the
first-model delivery numbers do not establish the all-event/browser 500ms gate.

`scripts/benchmark-classic-conversation-sse-browser.mjs --runDirectory RUN
--frontendOrigin http://localhost:5173 --output REPORT.json --channel chrome`
passed a real one-user/one-tab classic UI login, fresh-conversation send, canonical
completion and the application's frontend-paint POST. Branded Chrome155.0.8059.84:
frontend render 292.18 ms, browser-only render 74.02 ms; one 50 ms long task during
2.492 seconds of observed generation. The private context routes only frontend
assets and isolated API traffic, blocks WebSockets/service workers and never
persists credentials/browser state. An initial attempt could not launch the
uninstalled bundled Chromium revision; the explicit installed Chrome channel
passed (`browser-smoke-02.json` in the same run directory). This smoke is not the
10/30-user browser load matrix, cold/reload qualification or a baseline comparison.

Current focused Node checks total 18 (14 benchmark, two acquisition races and two
browser-outcome regressions). Browser review found a deadline race: outstanding
browser work could overwrite a timeout as success. A final cancellation check and
detached terminal report now keep late evaluations from changing timeout evidence;
the delayed-evaluation regression passes.
Required reviews passed the instrumentation, bootstrap cancellation/TLS/fixture
corrections, conservative failed-send cleanup, history classification and matrix.
Browser-tool required review also passed after the deadline correction. No optimization is justified or implemented
from this preview alone. Raw reports have not been uploaded as CI artifacts.
