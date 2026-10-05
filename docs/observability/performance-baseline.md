# Performance baseline — unified logging

Status: **PARTIAL** — SDK-level fault and benchmark gates executed on the local runner (P09, `adk11-migration`); whole-service comparisons require the P10 canary environment. Raw reports: `.generated/observability-reports/{faults,benchmark,smoke}.json` (runner: Windows x64, Node 25.5, local-test profile).

## Measured results (controlled, local)

| Check | Result | Evidence |
|---|---|---|
| Blocked sink (never-draining stderr), 4000 events × 768 B | PASS | emit p99 **37 µs** (budget ≤100 µs), RSS plateau **82.6 MiB** (4 MiB queue + 4 MiB sonic buffer + runtime margin), 1952/4000 shed with counters, caller never blocked (T10/T09) |
| Healthy file sink, 20 000 events (steady state) | PASS | emit p99 **12.2 µs**, p50 3.9 µs, **~185 000 written events/s**, written == admitted, zero loss (mode B) |
| Level gate only (mode A) | PASS | p99 0.3 µs — disabled logging costs nothing |
| Unpaced burst (mode F) | PASS | 17 952/20 000 shed by capacity with counters; every admitted event written |
| Worker death → restart → recovery | PASS | restart counted, credits released, post-recovery events written; 1 event lost in the killed worker's buffer (documented loss window) |
| Policy gate self-test | PASS | deliberate `console.log` probe fails the gate; clean tree passes (T29) |
| Diagnostic SQL prohibition | PASS | facade imports no buffer/DB symbols; inverted pg integration test in backend suite (T18) |
| Live stack: label allowlist | PASS | Loki exposes exactly `container, environment, service_name, severity_text, source` (T25) |
| Live stack: canary query + body search | PASS | events queryable by `service_name`; JSON envelope retained (T24a/b) |
| Live stack: gateway outage + recovery | PASS | alloy logged bounded retries (2 warn/error per 30 s), no crash; pipeline green ≤15 s after gateway restart, zero application restarts (T19/T20-lite) |

## Budget (contracts/observability/budgets.v1.json)

Machine-readable thresholds requiring a reviewed change to relax: p99 caller-side emit ≤ 100 µs target, added p99 request latency ≤ 5 ms vs baseline, ≤ 1% throughput regression, bounded pending events/bytes (2048 / 4 MiB with 512 KiB error reserve), shutdown drain ≤ 1000 ms.

## Still NOT_RUN (requires the P10 canary host and built service images)

Whole-service modes A–F vs baseline (added p99 ≤5 ms, ≤1% throughput), TTFT, 10/30/100-concurrent session sweeps, T12 HTTP→gRPC→MCP chain, T13 30-user isolation, T14/T15 streaming/job correlation, T21–T23 (Loki auth/DNS/disk/process-kill), T26–T28 deployed-surface checks. Protocol unchanged: deterministic stubs, warmup + repeated runs, distribution reporting via `scripts/observability/benchmark.mjs`.
