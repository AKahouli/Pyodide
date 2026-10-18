# Narrow recall and concise test output — 2026-10-18

## Changes and reason

The [first code repair comparison](HINDSIGHT-CODING-EVALUATION.md) found useful
experience but also stale task instructions, unrelated facts and high cumulative
token use. The root causes were raw conversation facts participating in default
recall, permissive retrieval thresholds, and repeated verbose test/DOM output.

The installed client and versioned template now request only consolidated
`observation` lessons in the existing strict `memory:durable-v1` scope. Native
semantic/keyword floors are 0.87/1.0, with graph/temporal expansion still disabled
and the requested content budget unchanged at 1,500 tokens. Keyword 1.0 is a
strict threshold, not a disabled retrieval arm. No new service or custom production
retrieval filter was added.

Extraction/consolidation missions now explicitly exclude thread-local next
actions, no-commit/browser-QA instructions, old approvals and test totals even
when a transcript calls them settled or verified. Every interaction remains
captured; historical facts were not deleted or rewritten for this evaluation.

Root, versioned global and installed OpenCode instructions tell agents to save
full output to unique local logs/reports, inspect concise counts and bounded
failure details, expand only for a specific error, and preserve the actual exit
status. Relevant source reads should also be bounded rather than repeatedly
loading whole files. The simple-question/example rule remains present.

Native `memory-policy` applied and verified the bank missions with private
backups. All 19 installer tests passed. Existing OpenCode hosts must restart to
load new client settings and instructions; no user host was stopped.

## Precision check and limits

For the same connector query, the native injection cache now contains one lesson
(905 characters including its recall lead), versus 14 facts / 7,577 characters
previously: **88.1% less injected text by characters**. This is not an exact model
token count. The block contains the cause, remedy, explicit-prefix/profile
transition rule and verification limitation, without old task status or test totals.

The selected observation is unedited and has empty edit history. All 14 underlying
facts are unedited ordinary OpenCode conversation captures from three sessions;
none is a curated seed. Private provenance evidence records source IDs and documents.

Four earlier lesson probes still matched: protobuf Struct, inspector overlap,
inference/cache identity and obsolete SDLC ownership. The QA/login probe missed.
Two unrelated controls (Portugal's capital and button color) returned no lesson.
These earlier seeded queries are regression probes, separate from the uncurated
coding lesson; they are not an independent relevance benchmark.

Observation-only recall can miss fresh facts until consolidation completes and
stricter scores can miss paraphrases. Agents continue with source, tests and Git
docs when recall is empty. The thresholds are calibrated to this embedding setup;
observations and extraction prompts do not guarantee that every future recall is
free of historical status.

## Repeat comparison protocol

The same reconstructed real connector regression and original withheld 36-test
suite are reused from the first comparison. Product source and pre-fix component
hash are unchanged. Two fresh isolated repositories have identical instructions
and test fixtures, using the same native OpenCode `build` agent and
`openai/gpt-6-luna`; automatic memory is the difference within this pair.

Both arms receive the new concise-output guidance and use the same private Node
evaluation fixture to run the original Vitest suite with a JSON reporter. The
fixture saves full logs/reports under unique names, prints counts and bounded
failure details, and propagates test failure, timeout and missing-report errors.
The fixture is evaluation-only and is not a new production dependency. Agent
patches and full logs are preserved; independent scoring temporarily uses the
same original test suite and restores agent-written tests afterward.

Order is reversed: memory first, then control, sequentially. Retention and bank
management are disabled for both sessions, so their answers cannot train the
comparison. The read-only proxy records the actual native recall without changing
its query, filters or results. No curated lesson is injected; provenance is checked
after retrieval. Existing product working changes and live services are untouched.

Explicit MCP tools are disabled in both benchmark arms; automatic recall remains
active in the memory arm. One agent's opening message nevertheless described
Hindsight as unavailable. The native injection cache verifies the recalled block:
this is a communication error conflating direct tool availability with automatic
context injection, not evidence of a Hindsight service outage.

One repeat pair on the same historical bug is a tuning regression check, not a
new unseen task or a randomized productivity trial. Source verification remains
required. Comparing this pair to the earlier one combines recall/output changes,
different order, caches, current consolidation and model variation; it cannot
isolate the causal contribution of each change.

Usage counts native OpenCode model steps, including repeated cached context;
these are not single-context sizes or provider bills. Normal background Hindsight
extraction/consolidation usage is outside these measurements, and capture is
disabled for the evaluation sessions. Independent original-suite checks run after
both native sessions, so their CPU work does not disturb either timed agent run.

An initial repeat attempt was excluded because its private test-summary fixture
had a missing parenthesis. The agent correctly reported tests blocked. That
attempt is preserved separately, both owned code copies were reset, and the
corrected fixture passed `node --check` plus a baseline check reporting exactly
30 passes / six failures with exit 1 and bounded output before the valid pair.
Only the owned evaluation runner was stopped; no user OpenCode host was stopped.

## Results

| Measure | Without automatic memory | With tuned memory |
| --- | ---: | ---: |
| Independent original tests | **36/36 passed** | **36/36 passed** |
| Agent's final own tests | 34 passed | 33 passed |
| Agent completion, startup/provider included | 3 min 45.045 s | 4 min 58.289 s |
| Independent scoring time, additional | 48.466 s | 50.201 s |
| Agent plus passing independent check | 4 min 33.511 s | 5 min 48.490 s |
| Uncached input tokens, cumulative | 64,293 | 129,413 |
| Cached input tokens, cumulative | 920,448 | 986,368 |
| Output / reasoning tokens | 3,818 / 1,839 | 3,893 / 1,078 |
| Total processed tokens, including cached input | 990,398 | 1,120,752 |
| Model steps / tool calls | 20 / 29 | 25 / 33 |
| Component-test invocations | 2 | 4 |
| All tool-output characters | 177,990 | 149,037 |

Within this repeat, measured correctness is equal. The memory arm used **13.2%
more total tokens**, **101.3% more uncached input**, and took **32.5% longer** to
finish. Its extra test/debug iterations are visible in the trace. Retrieval itself
took only 186 ms. The comparison does not prove that memory caused those extra
iterations or timing differences; it does not support an efficiency win either.
Independent source review found no major defect in either requested repair.

### Compared with the earlier memory arm

| Measure | Earlier broad recall | Tuned repeat |
| --- | ---: | ---: |
| Injected recall characters | 7,577 | 905 |
| Recalled items | 14 raw facts | 1 consolidated lesson |
| Total processed tokens | 1,798,519 | 1,120,752 |
| Uncached input tokens | 107,091 | 129,413 |
| All tool-output characters | 288,004 | 149,037 |
| Agent completion | 4 min 11.359 s | 4 min 58.289 s |
| Independent original tests | 36/36 passed | 36/36 passed |

The tuned memory arm had **37.7% fewer total processed tokens** and **48.3% less
tool-output text** than its earlier counterpart, but **20.8% more uncached input**
and **18.7% longer completion**. Consequently there is no monetary-saving or
faster-delivery claim. The earlier control's missed round trip was not repeated
in this control, so this pair supplies no incremental correctness advantage for
memory. The original positive result remains evidence from one earlier sample,
not a guaranteed property of the harness.

## Assessment and remaining work

The requested precision/output changes are installed and passed their checks.
The observed recall is substantially smaller and contains a reusable lesson
rather than old task instructions. Concise test summaries preserved real failures,
full logs and successful reruns. Neither experimental repair was applied to the
product working tree.

Keep the strict 1,500-token policy as a bounded context aid, with source/Git
fallback. This comparison does **not** justify marketing Hindsight as a token or
time saver. Test-fixture mistakes and repeated debugging remain major costs. The
next useful assessment is a different real task with existing uncurated lessons,
using alternating/randomized order and multiple samples; do not keep optimizing
this same known bug or curate its memory to improve the score.

Private evidence is retained under
`C:\Users\zadmi\.hindsight\backups\precision-20261018\evaluation\`:
native raw events/usage, exact prompt, recall request, unedited source provenance,
injection cache, independent original-suite results, agent test runs/full logs,
baseline hashes, patches and the excluded fixture-error pilot. No client
credentials or raw conversation transcripts are committed. Timing excludes
experimental setup, the invalid pilot and report/review work. No browser QA,
provider call, full typecheck or cross-service acceptance was performed.
