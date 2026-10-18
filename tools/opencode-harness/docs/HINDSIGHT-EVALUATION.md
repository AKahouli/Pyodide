# Hindsight recovery and usefulness check — 2026-10-18

## Outcome

Memory supplied useful project-specific context in one read-only OpenCode test.
It did not demonstrate faster overall task delivery. Focused retrieval became
more precise after source-checked lesson curation and native filtering; these
small curated checks are not an independent general benchmark.

The subsequent [real-code repair comparison](HINDSIGHT-CODING-EVALUATION.md) used
automatically captured lessons instead of those curated seeds: memory improved
the independently tested result in that pair, but consumed more tokens and still
recalled historical task-status text. It supersedes any inference that this first
retrieval check established general efficiency or fully solved memory noise.

## Recovery

- Six failed operation records were three retain jobs plus their batch parents.
  Causes were historical disabled Claude subscription access and expired shared
  Codex authentication. All six records reached `completed` after retry with the
  currently working provider. No credential or account was replaced.
- Four pending jobs carried obsolete provider backoff until October 22. Their
  pending state was checked before cancel/retry; all four reached `completed`.
- Recovery reset 35 permanently failed consolidation facts. The failed-fact
  count returned to zero and consolidation resumed. Pending source facts were
  still being processed; zero failed facts does not prove full consolidation.
- At the 11:08 UTC snapshot: zero failed operations, zero failed consolidation
  facts, 19 pending operations and two processing operations. Active coding
  sessions continued submitting work; pending consolidation had fallen from
  1,110 at inspection to 358. Those counts are historical, not live status.

No memories or failure records were deleted to clear counts. Private client/bank
settings, original operation payloads and final operation outcomes were backed
up under `~/.hindsight/backups/maintenance-20261018/` on the Windows host.

## Retrieval experiment

Five questions covered protobuf Struct serialization, inspector overlap,
inference-profile cache identity, QA authentication and stale edit ownership.
Raw and observation-only requests were measured before configuration changes.

| Setting | Total hits across five queries | Manually relevant among first six per query | Direct API latency |
| --- | ---: | ---: | --- |
| Previous world/experience, 1,000 tokens | 56 | 14/30 | 146–396 ms |
| Observation-only candidate, 1,500 tokens | 84 | 9/30 | 85–571 ms |
| Curated durable scope and filters, 1,500 tokens | 5 | 5/5 returned hits | 41–148 ms |

Observation-only recall was rejected: it retained stale QA/task narration and
did not resolve the ownership question. For the final check, six lessons were
explicitly seeded from inspected source and accepted ADRs, covering the five
queries plus the maintainer capability fallback. Thus the last row measures
retrieval of known curated lessons, not discovery of previously unseen knowledge.
No stale task-status hit appeared in that final five-query run.

Two unrelated controls—Portugal's capital and changing a button's color—returned
no memory with the final settings (42–73 ms). Before confidence filtering, even
the capital question returned all six engineering lessons. The local RRF ranker
orders candidates without relevance-confidence scores. Semantic/keyword floors
0.84/0.4 plus disabled graph/temporal expansion produced these observed misses.
The cutoffs are specific to the current embedding setup and can lose weakly
phrased matches; recheck them after embedding/ranking changes.

One extracted inspector lesson omitted `modules/` from its source path despite
an explicit instruction to preserve identifiers. The stored fact was corrected
against source before the final run. This is direct evidence that recalled
paths require verification.

## Actual OpenCode checks

Fresh OpenCode 1.19.3 processes used `openai/gpt-6-luna`, the installed harness,
current instructions and native Hindsight integration. Each had its own memory
configuration; capture was disabled for these evaluation conversations to avoid
feeding test answers back into memory. Prompts prohibited tool use; the raw
traces contain no tool calls, and no source was edited.

For the same inspector question, the control with `autoInject: none` said the
file/helper was unknown. With recall enabled, the agent named
`YellowStorm/front/src/modules/semantic-model/pages/SemanticModelEditorPage.tsx`,
`applyInspectorSelection`, and the mutually exclusive transition. It also avoided
claiming current browser QA success.

| Observed result | Without automatic recall | With automatic recall |
| --- | ---: | ---: |
| Existing helper identified | No; honest unknown | Yes; correct helper/path |
| Input tokens | 8,393 | 8,887 |
| Wall time, including startup/provider | 60.443 s | 60.727 s |

The observed input difference was 494 tokens. Output lengths differed, and one
pair cannot attribute timing differences or establish general productivity gains.
The 1,500-token limit budgets recalled content; plugin guide text is additional.

A separate communication probe asked the agent to clarify local versus shared
file storage. It asked one short question, used a private-draft/team-report
example, explained access/storage implications, and recommended local storage
unless collaboration was needed. This verifies a sample response, not universal
compliance with the new instruction.

A synthetic status-only extraction probe containing pending work, login/review
status, test counts and a page identifier completed with zero extracted facts.
Only that owned synthetic document was removed after verification. This checks
one example; it does not guarantee every future transient update is filtered.

## Persistence and practical limits

The template and installed client use a strict `memory:durable-v1` scope, a
1,500-token budget and extraction missions that omit temporary status. Full
interaction capture remains enabled in normal use. Existing records remain
available for explicit historical investigation. Parallel enrolled worktrees
resolve to the same repository bank; neither evaluation process changed that
mapping. Restart existing hosts to load client/instruction changes.

The local API was 1.0.0. Bootstrap now pins `hindsight-embed==1.0.0`, whose
profile/daemon CLI help was checked. The installer verifies recall score-filter
capabilities and bank knobs before declaring policy verified; older incompatible
services produce an advisory upgrade message. A fresh interactive authentication
installation was not repeated on this already configured machine.

Private measurement JSON is retained beside the recovery backups in `evaluation/`.
No evaluation credentials or transcripts are committed. Reviewed source/ADRs and
current checkpoint state remain authoritative. The practical value demonstrated
here is fewer missing-context answers, with a modest observed input-token cost.
