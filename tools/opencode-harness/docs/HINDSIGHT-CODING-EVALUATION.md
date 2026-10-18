# Hindsight coding comparison — 2026-10-18

## Question and protocol

Does automatically captured project experience improve a real code repair beyond
the same source, Git documentation and task description without automatic recall?
This follows the earlier [curated retrieval check](HINDSIGHT-EVALUATION.md).

The task repairs the connector editor's doubled authentication-scheme bug: the
provider token receives a `Bearer ` prefix in the editor and another at the MCP,
causing Microsoft Graph 401 responses. Correct behavior also preserves deliberate
empty, bearer and custom prefixes, restores ordinary automatic defaults when
leaving the assertion profile, and serializes the intended value in either
selection order. The request supplied the receiving-MCP scheme behavior to both
agents; this measures implementation beyond that clue, not blind root-cause discovery.

- Source: committed product snapshot `abe23f8f99d6d371f0bfd9155d5727327d0f3a17`.
- Two isolated repositories with identical code, docs and instructions. Only the
  existing prefix-provenance repair was removed; seven associated regression
  cases were withheld. This is a reconstructed historical regression in real
  product code, not a newly discovered production defect or an exact historical checkout.
- Native OpenCode `build`, `openai/gpt-6-luna`, one fresh session per arm. Same
  prompt, tools, instructions, installed dependencies and component-test command.
  Source edits and test execution were allowed; browsers, delegation, external
  providers, package installation and production changes were outside this test.
- Control: automatic recall disabled. Memory arm: automatic native recall with
  the installed 1,500-token budget and relevance settings. An evaluation-only
  read proxy additionally requires `source:chat` and `harness:opencode`, excluding
  the six curated seed lessons. The live bank's facts and policy were not edited.
- Both sessions disable retention and automatic bank management. Evaluation
  answers cannot feed back into their memory input. Per-run client configs are
  private and removed after execution. Source documents/lessons are not curated
  or rewritten for the test.
- Fixed order: control, then memory, run sequentially. Dependency caches are
  shared; startup/provider load, warm caches and model variability can affect
  timing. One pair cannot establish a general speed or token advantage.
- Scoring uses the same withheld original 36-test suite, independently of the
  tests each agent writes. Baseline: **30 passed, 6 failed**, all six failures
  matching the recreated prefix bug. Agent tests are preserved after scoring.

## Results

| Measure | Without automatic memory | With uncurated memory |
| --- | ---: | ---: |
| Independent original tests | 35/36 passed | **36/36 passed** |
| Agent's final self-reported tests | 32/32 passed | 35/35 passed |
| Agent completion, including startup/provider | 4 min 52.674 s | 4 min 11.359 s |
| Independent scoring time, additional | 43.024 s | 37.082 s |
| Passing independently checked repair | Not reached | 4 min 48.441 s |
| Uncached input tokens, cumulative | 73,865 | 107,091 |
| Cached input tokens, cumulative | 1,070,464 | 1,683,456 |
| Output / reasoning tokens | 4,238 / 1,588 | 4,779 / 3,193 |
| Total processed tokens, including cached input | 1,150,155 | 1,798,519 |
| Model steps / tool calls | 21 / 31 | 25 / 34 |
| Component-test invocations, including targeted reruns | 4 | 3 |

Tokens sum native OpenCode `step_finish` usage across the conversation. Cached
context is counted again when processed on another model step. These totals are
not a single context-window size and do not imply equal billing rates for cached
and uncached tokens. The model's pricing metadata reported zero cost; no monetary
saving is inferred from it.

The memory arm used **56.4% more total tokens** and **45.0% more uncached input**.
Its agent completion was **14.1% faster in this pair**, but fixed order, warm
caches, differing test iterations and model/provider variation prevent attributing
that difference to memory. Agent completion is not verified delivery: the control
still failed a required behavior after independent checking. No browser QA,
provider call, full typecheck or cross-service acceptance was performed in either arm.

## What memory contributed

Native session-cache evidence contains the injected text: 14 recalled facts,
7,577 characters, supplied by a successful 1,059 ms recall within the configured
2,000 ms injection timeout. The request used `max_tokens: 1500`; characters do not
establish an exact model-token count, and plugin guide text is additional.

Every returned fact references an ordinary `conversation:` source document with
`source:chat`, `harness:opencode` and `memory:durable-v1` tags. The two source
conversations predate the valid evaluation; neither is a curated seed document.
The memory arm explicitly attributed the raw-prefix rule to Hindsight and still
checked the Git contract and source. Particularly useful was the captured lesson
that automatic defaults must be restored when leaving the assertion profile while
deliberate prefixes remain unchanged.

Independent source review confirmed the concrete difference: the control cleared
the automatic default on entry to `internal_jwt` but left it empty on returning
to the ordinary profile. The memory patch recalculates the automatic default in
both directions and stops automatic changes after an explicit edit. The same
withheld round-trip test failed for the control and passed for the memory arm.
This is evidence of a useful retained lesson in one repair, not proof that memory
caused every observed implementation difference.

## Remaining quality and efficiency gaps

The recall block also included historical test counts, readiness announcements
and task-specific instructions such as not committing or repeating browser QA.
Other recalled facts concerned unrelated security work. Thus the earlier
status-only synthetic extraction success does **not** establish that normal
conversation extraction or recall contains only durable lessons. The valid agent
followed the current evaluation scope and reran tests; it did not use the old pass
counts as current proof.

The chat-only evaluation filter excludes scoped consolidated observations as well
as curated seeds, so it is narrower than normal production recall. A separate
read-only probe of the default policy also returned historical task status and
unrelated facts; that probe was not injected into either scored session. Production
recall needs its own subsequent held-out check before claiming the same benefit.

Tool output was also large: 201,678 characters for the control and 288,004 for the
memory arm. Failed component tests produced verbose DOM/error output, and repeated
context processing magnified that cost. The next useful tuning targets are:

1. Separate reusable fix/decision facts from old task instructions at extraction
   and recall, preserving the underlying history for explicit investigation.
2. Narrow recall to the symptom and changed area; the native query currently uses
   the beginning of the whole task, including broad workflow/security vocabulary.
3. Read bounded source sections and concise failure summaries, expanding only for
   a specific unresolved error. A 1,500-token recall budget alone cannot control
   long tool output or repeated context.
4. Repeat on additional held-out tasks with alternating run order before changing
   defaults based on speed or token claims. Do not hand-edit lessons to pass them.

Keep the present 1,500-token setting while improving precision. This experiment
supports memory as a correctness aid; it does **not** demonstrate token savings.

## Evidence and invalid attempt

One initial memory attempt received HTTP 422 because the evaluation proxy combined
the mutually exclusive `tags` and `tag_groups` request fields. It had no injected
recall, was stopped after approximately 59 seconds, and was excluded from the
paired metrics. Only its owned evaluation process was stopped. The proxy was
corrected to one strict tag group, the owned code copy was reset to the identical
baseline, and the successful run used a fresh session. The invalid attempt is
preserved separately; this was an evaluation-fixture error, not a production
Hindsight configuration change.

Private evidence is retained under
`C:\Users\zadmi\.hindsight\backups\maintenance-20261018\evaluation\coding-task\`:
baseline hashes, exact prompt, per-step usage, native injection cache, recall
provenance, independent test results, patches and the invalid pilot. No credentials
or transcripts are committed to Git. Independent review found the control's
round-trip defect and no evident correctness issue in the focused memory patch;
the original tests independently confirmed the difference. Neither experimental
patch was applied to the product working tree.

## Communication rule

The repository root, versioned global template and installed OpenCode `AGENTS.md`
already require simple words, a short concrete example, an explanation of why a
necessary choice matters and a recommended default. This request needed no
duplicate instruction. For example: “Should files stay on your computer or be
shared with your team? A private draft can stay local; a team report needs shared
storage. I recommend local storage unless others need access.” Instructions guide
behavior; a single sample does not guarantee every future response follows them.
