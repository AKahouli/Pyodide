# Semantic runtime P0 correctness and release gate

## Source and verification identity

Plan baseline: `33cfe3300f251cb972e91fd91c1bfeffc5e19495`.
Implementation started at `c4e3c0726836412849903bbd3a416347ef58a1b4`, preserving
the newer autonomous AI extraction. Concurrent instruction/conversation commits
moved the tested HEAD to `0fca84ee6074023ea1f4bd13ee782f9a29fc34b1`; the P0
run exercised a dirty worktree atop that commit. Its source fingerprint identifies
the tested changes independently of subsequent commit packaging; no released
commit or commit-associated CI result is claimed.

`scripts/run_p0_gate.py` records the actual Git HEAD, dirty-worktree flag and
SHA-256 of runtime source/tests/migrations/runner/requirements/workflow in
`qa-artifacts/semantic-runtime-p0/evidence.json`; its sibling `junit.xml` is the
machine-readable test result. Use these together, never the baseline SHA alone.
The corrected integrated run passed **240 tests, 0 failures, 0 errors, 0 skips**
on 2026-10-15 in 122.64 seconds. Source SHA-256:
`4ed043b50cbb7ab88531ffaa2c9b2d5b753460c612a0d59f618f9b9aed287352`.
The run deliberately supplied a conflicting ambient runtime URL; all suite
connections were rebound to the validated disposable target. Earlier runs before
that isolation correction are not aggregate release evidence.

Required scoped review: **PASS**, all critical/major findings resolved, including
post-lock cutover expiry, terminal-generation retry reconciliation, exhausted
attempt cleanup and test-DSN isolation. Additional core compatibility coverage:
**182 passed**, covering jobs, autonomous inference, document/cell/tabular/derived
population, concept refresh, scoped reads and projection/exposure behavior.
Those projection tests use controlled adapters; they do not establish live AGE.

## Implemented protocols

- **F1:** one renewal-loop async lock serializes query/reconnect/close on the
  guard's connection. Explicit checks are bounded real DB verifications, not
  successful local health reads. Stop cancels queued/in-flight checks and joins
  the private thread; lost/stopped attempts cannot restart.
- **F2:** search task ownership uses the same independent guard/configuration as
  datasource/population. Checkpoints use `renew=False`; only meaningful indexing
  progress renews the separate generation lease. Mutations use task → generation
  → batch/cache lock order, with owner/state/epoch and wall-clock expiry checks
  inside the transaction and after waits. Standalone builds fence generations.
  Ready-generation retries reconcile without rewriting terminal data; a current
  task may clean up an abandoned queued/indexing generation on exhaustion/stall.
- **F3:** task → job → `semantic:model:cutover:{model_id}` transaction advisory
  lock → freshness checks → binding CAS → task/job/event commit. Wall-clock
  expiry is checked after lock acquisition and at the terminal update, rolling
  back a delayed CAS. Correction INSERTs, selected-specification writes and other
  binding mutations share the short mutex. The long staging lock is unchanged.
  The API's optimistic correction precheck remains outside the INSERT critical
  section: two already accepted requests may both insert, as before.
- **F4:** a reproduced fresh-claim/cancel race skipped a locked queued task then
  counted only running rows, permitting a cancelled job with a running task.
  Counting remaining queued/running rows as potentially live requests a stop
  rather than publishing a terminal cancellation beneath an uncommitted claim.
  No claim/cancellation lock-order rewrite was made.
- **F5:** a dedicated PR/push/manual workflow runs the real PostgreSQL gate with
  Python 3.11 and repository dependencies. The wrapper requires explicit
  disposable loopback `semantic_p0_test` URLs, binds **all** runtime/test DSNs
  before collection, and fails on any skip, missing prerequisite or test error.
  Integration collection never loads deployment `.env`.

## Invariant checklist and owning tests

Paths below are relative to `YellowStorm/semantic-model-runtime/tests/`.
These are executable coverage mappings, not claims of completed staging tests.

| Invariant | Focused evidence |
| --- | --- |
| INV-1 current task/owner/epoch, DB clock | `test_task_lease_guard.py` takeover/outage; `test_graph_search_fencing.py` expiry/replacement/lock-wait tests; `test_cutover_serialization.py` lock-wait and delayed-CAS expiry |
| INV-2 independent worker identity | `test_worker_identity.py`; `test_p0_baseline_races.py::test_f01_second_instance_boot_leaves_first_instance_lease_intact` |
| INV-3 silent work and irreversible loss | `test_task_lease_guard.py::test_a_silent_stage_stays_owned_while_the_guard_renews`, overlap (100 rounds/two assertions), network/stop/takeover tests |
| INV-4 stale search/activation cannot publish | `test_graph_search_fencing.py` six-mutation stale matrix/cache rollback; `test_graph_search_resume.py` ready reconciliation/exhaustion cleanup; P0 stale-owner activation |
| INV-5 atomic binding/task/job/event | P0 stale-owner activation/rollback tests; cutover expiry tests verify binding and job rollback |
| INV-6 correction/spec linearization | `test_cutover_serialization.py::test_commits_serialize_with_fenced_cutover` (both writer kinds and both orders, with independent-model progress) |
| INV-7 claim/cancel/recovery consistency | P0 deterministic fresh/expired × normal/queued-only matrix; 100 iterations per cancellation mode, seed **20260314** (200 total); three actors over independent pools; exactly one terminal event |
| INV-8 compatibility | Population command/task suites, graph build/resume/incremental suites and existing scoped authorization/contracts; live end-to-end M10 remains required |

Fail-before evidence includes the overlap test against the exact original guard
from `c4e3c0726` (`asyncpg.InterfaceError`), deterministic queued claim/cancel,
two finalization-expiry races, and three search retry/exhaustion/stall cases.
Focused pass-after runs: guard 10; search 75 including 21 real-DB cases; cutover
10 including the two expiry cases. The aggregate JUnit report supersedes
separately reported counts; do not add overlapping suite totals together.

## Reproduce the database gate

Provision a disposable local PostgreSQL instance with database
`semantic_p0_test`, pgvector >= 0.7, pg_trgm and pgcrypto. Fixtures explicitly
reset schemas: never supply a shared/dev/production database. From the runtime:

```powershell
$env:SEMANTIC_P0_DISPOSABLE = '1'
$env:SEMANTIC_RUNTIME_TEST_DATABASE_URL = '<disposable-loopback-DSN>/semantic_p0_test'
$env:SEMANTIC_RUNTIME_GUARD_TEST_DATABASE_URL = $env:SEMANTIC_RUNTIME_TEST_DATABASE_URL
conda run -n meta python scripts/run_p0_gate.py
```

The local disposable engine is PostgreSQL **16.15**, pgvector **0.8.0**, pg_trgm
and pgcrypto. No AGE or live broker/provider was used for these DB race tests.
TLS tests generate local CA/server certificates and verify that `rediss://`
configuration accepts a trusted chain and rejects an untrusted peer; they are
TLS handshakes, not broker interruption/dispatch tests.

CI workflow: [semantic-runtime-p0.yml](../../../.github/workflows/semantic-runtime-p0.yml).
Required artifact: `semantic-runtime-p0-<tested commit>` with evidence JSON and
JUnit. **Workflow URL: pending; no remote CI run is claimed.**

## Local mail_model smoke (not M1–M10 certification)

The user-authorized browser run of existing `mail_model`
(`61ce5cd7-68e6-4ade-a5e8-cf42e3d108a8`) reached `completed_with_gaps`:
job `8a70cf1e-6d17-4275-a700-e7e8f74a77b0`, terminal observed at
2026-10-15T09:02:15Z, duration 3 min 45 s. All 3 sources and 353 elements
finished; 10 AI calls answered, none failed. The activated draft
`dr_e2200e46df16f7d45eece617` contains 227 entities, 126 relationships,
1,093 assertions and 24 nonblocking gaps, with no job error code. The canvas
changed from 228 to 227 records and reported data up to date. No second population
run, source/spec/correction edit, publication, reset or deletion was performed.

Browser QA exposed a stale admission-status display: the editor copied terminal
job states into its outcome but left a queued outcome unchanged while the API
reported running. The editor now synchronizes the matching nonterminal query
state, including stop-mode selection. The queued-to-running regression failed
before the change; 48 focused editor/progress-panel tests and TypeScript passed
afterwards. Reloaded browser QA confirmed the actual terminal display and draft;
the corrected live transition was covered by unit tests, without another run or
mocked browser response. Local artifacts are under
`qa-artifacts/mail-model/20261015-ec13868f/`. Separately, background search index
`1bcdd7ad-d1b1-4164-971a-a4df87416f0c` / job
`d307cf7f-b969-4fbd-8bdf-d9764de35961` failed `attempts_exhausted` after four
claims; a read-only DB inspection found preceding outbox code `DataError`.
Its underlying argument/SQL failure remains undiagnosed; zero reported embedding
calls does not establish that no provider request occurred. Population success
does not establish search-index success or any multi-replica chaos criterion.

## Multi-replica staging report

**Overall release status: BLOCKED pending staging evidence and commit-associated CI.**
Use one API, durable dispatch/recovery, shared broker, isolated PostgreSQL+AGE,
and at least two independent Celery instances per tested role, `--pool=solo`.
Exercise same-hostname and separate-hostname replicas.

| Case | Fault / required evidence | Result |
| --- | --- | --- |
| M1 | Restart B under A's hostname; A owner/epoch retained, both heartbeats visible | NOT RUN |
| M2 | Silent parser/AI/index wave exceeds task lease; no duplicate claim | NOT RUN |
| M3 | Kill A; B recovers after expiry; exactly one final completion | NOT RUN |
| M4 | Renewal DB outage beyond granted lease; A stops effects, recovery restores progress | NOT RUN |
| M5 | Broker stop/start; outbox recovery and one terminal state | NOT RUN |
| M6 | Provider timeout/429/5xx and healthy slow wave; bounded retries/batch resume/no false ready | NOT RUN |
| M7 | Correction/spec selection versus activation under live replicas | NOT RUN |
| M8 | Claim/complete/recover/cancel injection; no deadlock/resurrection/double terminal | NOT RUN |
| M9 | Graceful drain while peer accepts queued work; eventual reconciliation | NOT RUN |
| M10 | Discovery/population/search/corrections and source authorization end to end | NOT RUN |

Attach tested commit and image digests, workflow URL, worker instance IDs/queues,
fault commands, DB job/task snapshots, total/failed/requeued counts and measured
takeover/completion timings. No throughput or SLA claim has been measured here.
Do not label production multi-worker scale-out validated until every release
checkbox from the approved plan is evidenced.

## Rollback

Record the previous deployed image digest and migration version before rollout.
Stop admissions and drain writes; let work finish or expire before changing
worker versions. Reconcile durable leases and outbox before rolling back; avoid
mixed incompatible ownership implementations on one queue. Do not manually
complete an unfinished job or bind an unvalidated candidate. Preserve published
bindings, immutable assets and unserved staging rows for explicit idempotent
cleanup. No P0 schema migration or destructive rollback is required. Until the
full gate passes, retain the previously validated deployment topology.
