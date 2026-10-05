# Root delegation qualification — 2026-10-05

Source review: **PASS** for coordinator ownership, Stop/replay, sealed synthesis, current-authority evidence resolution, and shared model capacity. Production rollout: **not qualified yet**.

## Executed checks

- Shared conda meta: Python 3.12.14, google-adk 2.11.0; ABI/import checks passed.
- Native regression: 85 passed before the last read-tool refinement; updated synthesis suite 3 passed, including real ADK tool execution and checkpoint recovery.
- Backend PostgreSQL regression: 58 passed; updated follow-up publication suite 9 passed, including sibling artifact identity collisions, unsupported final citations, expired deadlines, and Stop suppression.
- Latest backend follow-up/evidence/artifact suites: 31 passed. Production backend build and proto copy passed; frontend build and prior 39-test regression passed. Updated replay/panel suite 9 passed.
- Actual browser foreground inference passed after Python upgrade and again after the final default-off source rebuild/restart (`vector-final-default-off-smoke.png`). Disposable actual-component UI checks passed for desktop/mobile Stop, pending cancellation/retry, and typed false background approval. This was not an enabled live background run.
- Actual configured `gpt-6-luna` through production LLMFactory and ADK Runner: 172 synthetic task markers passed. Two capacity objects shared the isolated SQL slots in one process; this is not a cross-process benchmark.
- Actual provider plus fenced PostgreSQL ADK session: one durable checkpoint/recovery test passed; a fresh service recovered the original committed invocation without another model run.

## Real-model load

| Mode | Tasks | Passed | Median task seconds | Sampled peak slots | Residual slots |
|---|---:|---:|---:|---:|---:|
| Baseline | 1 | 1 | 19.287 | 0 | 0 |
| Baseline | 10 | 10 | 1.379 | 0 | 0 |
| Baseline | 20 | 20 | 1.492 | 0 | 0 |
| Baseline | 30 | 30 | 1.476 | 0 | 0 |
| Capacity enabled | 1 | 1 | 1.913 | 1 | 0 |
| Capacity enabled | 10 | 10 | 1.635 | 10 | 0 |
| Capacity enabled | 20 | 20 | 2.484 | 20 | 0 |
| Capacity enabled | 30 | 30 | 2.218 | 30 | 0 |
| Capacity enabled burst | 50 | 50 | 2.789 | 30 | 0 |

Task durations include agent construction and SQL acquisition. The first baseline task includes cold initialization; these are synthetic load measurements, not a controlled estimate of production Conversation latency. Occupancy is sampled every 50 ms. Deterministic capacity tests separately verify the hard slot boundary, stale fence rejection, provider EOF release before child dispatch, and retained unknown occupancy.

Reports: `vector-real-model-qualification-qualified.json` contains all successful samples. Preliminary `vector-real-model-qualification-full.json` retains a strict exact-format marker failure at the baseline 20-task stage; the final run checks marker presence and records response length. The configured default `gpt-5.4-mini` returned AuthenticationError; the previously working browser route `gpt-6-luna` was used instead. No secret values are included in reports.

## Remaining gates

Enabled native-to-Nest HTTP/gRPC background execution and UI publication; real Logical Search/connector/sandbox fixtures; governed pinned-profile qualification; cross-process crash/fault/soak and rollback rehearsal. User input is pending for the safe workspace, governed Root, and connector resource. Main database migrations 0044/0045, capacity/background enablement, and saved profile/grant changes remain unapplied.

Only `agentstore_test` received qualification writes. Main frontend/backend/gRPC ports remain 5175/3002/50053. Preserve unrelated uncommitted logging, package, contract, infrastructure, and script work.
