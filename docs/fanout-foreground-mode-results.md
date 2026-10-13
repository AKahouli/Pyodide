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

## Source-reference rejection follow-up

Conversation `605255603b964ab171836cc2` failed for a different reason: the model supplied that conversation ID in every item's `contextRefs`. The admitted worker capability ceiling contained no workspace IDs, and no fan-out manifest was reserved. The backend correctly rejected the proposal with HTTP 400; ADK allowed the HTTP exception to terminate the answer.

The foreground dispatcher now recognizes only bounded HTTP 400 envelopes with exact known static `buildFanoutManifest` validation reasons. These reasons originate before reservation. It returns a safe failed result, with no execution IDs, raw response data, automatic retry, replacement references or implicit dispatch. Unknown/malformed/oversized 400 responses, conflicts and timeouts remain unchanged because they do not establish non-admission. Native WAIT and downstream manifest validation remain outside the recovery catch. Registered `tool.call.failed` warnings include fixed operation/tool metadata and the trusted ROOT run ID, without source IDs or model arguments.

Tool guidance and the existing skill version 1.4.2 distinguish worker-authorized workspace IDs from conversation/document IDs. Omitting references does not create source access. The ROOT should retrieve with its own authorized tools when appropriate, or explain a missing source capability and ask for the required source; it must preserve the user's document-only restriction.

Verification: **30 native tests passed**, including real Runner continuation after reference rejection, valid foreground dispatch and WAIT/resume; **32 backend tests passed**, including unauthorized conversation references rejected before reservation. These counts overlap earlier verification and are not added to the earlier 27. Reviewer: **PASS**. The installed existing skill ID and body were verified against the local version 1.4.2 source. Native runtime restarted only after foreground and background work were confirmed idle. No backend permission or frontend implementation changed; the backend change is test coverage only.

Live verification used the same Chrome session/tab and fresh conversation `6fb182a921559aa09a26f885`, with the original French document-only request. The ROOT used its available document-search connector directly for three searches. It reported no usable documents and asked a bound clarification about the meaning/context of the requested entry, with three editable suggestions. There was no exception, invented fan-out workspace reference, background job or claimed accounting analysis. The native ROOT is correctly waiting for the user's answer while the normal composer remains available. Screenshot: `C:/Users/zadmi/AppData/Local/Temp/smart-workspace-reference-recovery.jpg`. This qualifies natural behavior avoiding the invalid dispatch; the actual HTTP 400 recovery path is qualified by the real scripted Runner test, not by pretending the browser reproduced another rejected call. The source retrieval itself returned no usable documents; resolving that source/content gap is separate from this exception repair.
