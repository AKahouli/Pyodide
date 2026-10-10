# Fan-out without background execution

## Cause and repair

The failed conversation `0d6bf114018aab46d45b30f1` had frozen flags `background_enabled=false`, `fanout_enabled=true`, and `background_fanout_enabled=false`. The loaded orchestration skill preferred background fan-out without checking the current mode. The model called `run_fanout(mode="background")`; an uncaught `ValueError` ended the request.

The fan-out tool now describes the invocation's available modes. This guidance also reaches the ROOT instruction when the library specialist catalog is empty. Invalid/unavailable modes return a bounded failed result with `allowed_modes`, before admission, without execution/result IDs or automatic fallback. A registered `tool.call.failed` warning records the rejected mode validation without model arguments. Existing backend service and atomic reservation permission checks, native WAIT propagation, and uncertain-acknowledgement behavior remain intact.

The existing attached `mono-agent-work-orchestration` skill was updated to version 1.4.1 and its stored body verified against the local source. Foreground fan-out remains available when background tasks are disabled.

## Verification

- Focused native fan-out tests, real ADK Runner rejection recovery, and fan-out WAIT/resume: **18 passed**.
- Mono agent attachment including an empty-catalog fan-out ROOT: **5 passed**.
- Workflow assembly including the actual foreground-only tool and instruction: **4 passed**.
- Observability policy: **PASS**, 147 existing legacy baseline sites. Whitespace check: **PASS**.
- Plan and reviewer gates: **PASS**. Browser QA used the same signed-in Chrome tab, without changing the user's execution settings.

In fresh conversation `429221c9b1ed5c7f0f8c37cb`, the original database comparison naturally selected foreground fan-out. The ROOT completed with a three-row comparison, official links, two differences and a relevant next step. A concurrent arithmetic request returned `323` while the comparison ran. Persisted flags remained background disabled/fan-out enabled/background fan-out disabled; no background jobs were created. Two leaf workers completed; the SQLite leaf returned no valid deliverable. The ROOT recovered by checking official SQLite documentation directly and completed the requested comparison. This is not a three-of-three worker-success claim.

Screenshots: `C:/Users/zadmi/AppData/Local/Temp/smart-foreground-fanout-result.jpg` and `smart-foreground-fanout-running.jpg` in the same directory.

## Limits

A broader delegate test run had one failure, `test_production_bridge_parks_and_resumes_child`, with `WorkerExecutionRejected` after resume. The unchanged HEAD version of that test reproduces the same failure on the unchanged delegation path; it is separate from the fan-out mode repair. Initial outside-workspace baseline attempts needed an explicit Python import path; the successful reproduction used the conda meta environment with that path set.

Model instructions improve mode selection but cannot guarantee every model call is valid. The recoverable rejection is the deterministic protection. Historical failed messages remain unchanged; new requests use the repaired runtime. No frontend/proto/backend permission changes were required. Graph context tools were unavailable, so investigation used focused source and boundary reads. Unrelated semantic-model workspace changes were preserved.
