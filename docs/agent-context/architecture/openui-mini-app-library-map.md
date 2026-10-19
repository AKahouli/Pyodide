# OpenUI mini-app library reuse and migration map

Status: **composition/theme, generation guidance and integration qualification complete; dynamic exports remain separately scoped**.
Assessed 2026-10-17; composition phase authorized 2026-10-17.
Scope: polished, reusable mini-apps in Conversation v1. A generated-code sandbox
remains separately scoped.

The proposed [rich artifact reuse plan](openui-rich-artifacts-plan.md) scopes the next SVG/dashboard, saved-view export and upstream HtmlView phases with separate commits. Phase A SVG/dashboard reuse is implemented; saved-view exports and HtmlView remain separately scoped.

## Outcome and evidence

Adapt the demo's composable layout and visual primitives inside YellowStorm's
existing OpenUI library. Keep the host-owned MiniApp identity, reactive bindings,
private autosave, authorized document selection and saved agent-result bridge.
Use additive names and optional trailing props so saved conversation programs
continue parsing with their original signatures.

The live calculator in conversation `c78760e23c3d433018ffc663` renders two number
fields, an operation selector, a small result and Clear. OpenUI rendering works;
the generated interface follows the limited Mini* vocabulary. Source confirms
that MiniApp uses a vertical form, MiniButton exposes no visual variants and
MiniOutput uses small text. This is evidence of a composition/style gap; it does
not establish that the model cannot generate a keypad.

Upstream reference: `thesysdev/open-intelligent-ui`, HEAD observed as
`03213439358bf3408ad61a46ec9e3230c5572e48`. Source pages inspected through GitHub
main are mutable; verify the referenced files at this revision before copying.
Its MIT license requires retaining the copyright and permission notice with
substantial reused code. Record adapted files and revision in the implementation.

Current installed versions are react-lang/lang-core 1.0.1, react-ui/react-headless
0.18.1 and thesys 0.14.0. A newer demo source is not proof of compatibility with
these versions; mounted parser/action probes are an implementation gate.

## Reuse map

Proposed names below are local OpenUI component names within the existing
conversation library, not new frontend modules or services.

| Demo capability | Current YellowStorm counterpart | Proposed treatment |
| --- | --- | --- |
| Col / Row | MiniApp vertical fieldset; existing chat layouts | Adapt as MiniColumn / MiniRow with bounded gap, alignment and wrapping. They render children within the same MiniApp form/state context. |
| Grid | No dedicated Mini* grid | Adapt as MiniGrid: columns, responsive minimum item width and gap. Support both a fixed keypad and a dashboard that collapses on narrow screens. |
| Box / Card | Existing chat Card root; MiniApp container | Add MiniPanel for grouped content, semantic surface, padding, border, radius and bounded width. Keep the existing Card root/signature. |
| Title / Text / Caption / Label | MiniApp header; MiniOutput; citation-aware chat text | Add MiniText for reactive display/heading/body/caption roles and alignment; extend MiniOutput with optional display size and alignment. Reuse existing citation renderer when applicable. |
| Button / IconButton | MiniButton and shared shadcn Button | Extend MiniButton with optional trailing variant, size, icon, disabled and block props; use existing shared Button/icon assets. Add icon-only support only with an accessible label. Preserve the existing action and validate argument positions. |
| Pressable | No Mini* selectable tile | Later add a generic selectable tile if required by planner/choice tests; retain keyboard operation and explicit action semantics. Avoid nested interactive elements. |
| Input / TextArea | MiniInput with stable name, required/min/max and numeric-null handling | Keep the current binding/validation implementation; adapt visual treatment, placeholders/help and optional sizing. Preserve null, zero and incomplete numeric-entry behavior in tests. |
| Select / Checkbox | MiniSelect / MiniToggle | Keep stable names and typed bindings; expose consistent visual variants. Do not derive state identity from visible labels. |
| SegmentedControl / RadioGroup / Slider | Stock chat controls; no equivalent shared Mini* binding contract | Add only controls needed by the initial app corpus, using the same useStateField/reactive contract. A stock form control is not automatically interchangeable with a reactive mini-app control. |
| List and generic functions | MiniList; four bounded local functions | Keep existing functions. Adapt selected array/text/math helpers when a tested app needs them, with internal argument/result validation. Do not import the full demo function catalog. |
| Table / Chart | Existing sortable/filterable tables and chart selection | Retain existing components, typed interaction history and export logic. Qualify nesting inside a mini-app separately before promising reactive table/chart binding parity. |
| Image / SearchImage | Scoped document/generated/web image resolution and per-image loading | Keep existing image pipeline; reuse authorized references returned by tools. Do not replace it with the demo's image-search route. |
| Form / ToAssistant | MiniApp + AskAgent + MiniTaskResult | Keep existing host bridge. Do not adopt the demo Form identity or implicit button-label submission. |
| Theme and component CSS | YellowStorm semantic tokens, shadcn controls, OpenUI styles | Adapt spacing, hierarchy and interaction treatments under a mini-app scope. Map colors/fonts/surfaces to existing themes; avoid importing global :root rules. |
| Generation rules and examples | Shared definitions + generate-openui-prompt.mjs | Add composition guidance and several working examples. Generate vocabulary from exactly the mounted definitions. |
| Map, YouTube, SVG, HtmlView, timers and celebrations | Different existing capabilities or absent | Outside the first visual upgrade. Each needs its own functional, access, resource and export assessment. HtmlView remains the separately proposed sandbox phase. |

First implementation vocabulary: MiniRow, MiniColumn, MiniGrid, MiniPanel and
MiniText, plus compatible extensions to existing Mini* controls. Reuse existing
stock components where their schema and behavior already meet the requirement.
Avoid name collisions with Card, Button, Input, Text, Table and Chart.

## Host contracts that the adapters must preserve

ADR-0025 applies: state belongs to authenticated actor + conversation + source
message + text component + program digest. Keep the current authenticated GET/PUT,
500 ms debounce, bounded typed JSON, serialized writes, expected revisions and
explicit conflict recovery. Layout wrappers create no new state/form owner.
Keep stable MiniApp/field names and $variables; labels, translations, ordering,
icons and responsive rearrangement must not redefine state identity.

Adding render-only components does not rewrite stored program text or its digest.
An explicitly regenerated/edited program is a different identity; do not silently
copy private state/results across its new digest. Existing messages keep legacy
defaults. Optional trailing props preserve old positional calls, including null
placeholders. Test old and new programs against one mounted library.

MiniDocument continues listing completed current-conversation uploads. The server
rechecks membership, governed audience, source/revision, attachment policy and
each selected file. Current trusted attachments supply actual workspace IDs.
No layout/control may accept raw storage paths, arbitrary workspace IDs or file
bytes as a way around these checks. ADR-0017/0018 MCP isolation remains unchanged.

AskAgent remains explicit, flushes the draft and sends its acknowledged revision.
Local actions and autosave create no inference. Keep stable IDs for uncertain
transport retries; a later explicit run gets a new ID. MiniTaskResult continues
following the saved user/assistant link, enforcing actor/source/program/form
identity and stale-input checks. Reload restores the saved body/status; it must
not run the task. Cancelled/failed/interrupted partial output is not success.

The demo's control helper can send the label when a button has no action. Omit
that behavior in our adapter. A generated control must have a local action or an
explicit validated AskAgent action; missing/invalid actions are inert with a
readable error. Keep semantic tokens and bounded presentation props, with no raw
CSS, executable strings, resource-loading styles or unchecked HTML.

## Generation and limits

Teach composition rather than app templates: select a compact tool, a multi-field
workflow, a list editor or a data view according to the task. Use progressive
grouping, one clear primary action, readable outputs and useful empty/error states.
Examples should demonstrate a keypad, document summarizer and planner/scenario
tool while allowing arbitrary combinations of the same primitives.

Keep the existing 20 direct-child limit initially: nested row/grid/panel containers
let denser interfaces fit without a blanket increase. Add bounded child counts
and verify existing whole-program/state limits before selecting numeric budgets
for new wrappers. Preserve zero/false/null/empty values and internal validation
of all added functions. Follow the existing 55k prompt soft target and 60k hard
cap; measure the generated prompt and remove redundant instructions before
expanding it. Do not solve prompt pressure by dropping access/state requirements.

## Delivery and acceptance

| Separate commit | Work | Observable acceptance |
| --- | --- | --- |
| A — Composition and theme | Adapt bounded layout/text primitives, extend button/output presentation, map theme tokens and retain license attribution. | Same reusable primitives render a keypad, summarizer, planner and scenario panel; 390 px and desktop have no unintended horizontal overflow; keyboard focus remains visible; icon controls have labels; new large touch controls target at least 44 px. Existing saved Card/Mini* fixtures still render. |
| B — Generation quality | Regenerate prompt from mounted definitions; add varied composition examples and concise design guidance. | Fresh agent requests generate four usable app types without app-specific screens or invented components/functions. Controls visibly change local state/results; no local interaction unexpectedly runs inference. Prompt remains within budget. |
| C — Integration qualification | Exercise persistence, task bridge, compatibility and export behavior; repair confirmed integration defects. | Numeric/boolean/null/empty and unsubmitted values survive reload; same-user conflicting tabs do not overwrite; different actors remain isolated. Document summary remains accessible only through current authorization, and saved completed/cancelled results reload without new agent turns. Existing image/chart/report/slide export fixtures remain valid. |

Visual QA covers light/dark and the current themed surface with tokens, at mobile
and desktop widths. For each app verify hierarchy, grouping, readable display,
loading/error/empty states, tab order, Enter/Space behavior and visible focus.
Compare screenshots against the reference's spacing and control hierarchy while
using YellowStorm typography/colors. Verify calculator edge cases, planner list
changes, scenario zero values and summarizer stale/cancelled results.

Export scope must be explicit. Existing static answers/reports/slides and their
downloads must continue working. For the new layout nodes, extend structural
projection enough to retain readable content rather than dropping nested nodes.
A snapshot of current private draft values plus saved task results across
DOCX/HTML/PDF/editable PPTX is the already planned dynamic export phase 5; do not
claim it from visual-component support alone. Materializing/exporting that snapshot
must flush state, use one revision, revalidate resources and run no agent actions.

The first two commits need no new table, service, module or execution runtime.
Implementation remains within the existing Conversation OpenUI components and
generator. Any later proposed boundary change follows repository change control.
This assessment introduces no new durable platform decision or ADR.

## Verification state and source references

The user authorized commit A, composition/theme, after accepting this map. It adds
the five layout/text primitives and trailing MiniApp/MiniButton/MiniOutput options
inside the existing library. New wrappers allow 40 direct children, MiniApp retains
20, and rendering clamps numeric spacing/columns/widths. It introduces no package,
table, module, service or execution runtime. The exact registered schemas regenerate
the backend prompt; redundant existing guidance was condensed to retain the 55k
soft budget. No app-specific screens or new pure functions were added.

Source review accepted the composition/theme implementation without actionable
findings. Focused tests cover nested local calculator actions, reactive layouts
for scenario/list/summarizer apps, legacy positional calls, typed hydration and
document tasks under nested grids/panels. Production TypeScript and bundling pass. Live general-app reload retains price 0,
quantity 3, discount true and planner query osa/Osaka with unchanged message IDs
and usage. The 59 focused frontend tests pass. A generated keypad passes local 2+3=5 and
restores 5 after full reload with unchanged message IDs and usage. The existing
document reader restores phase4-scan.pdf, Short and its actual saved Maple summary
without executing the agent again; mounted fixtures verify
calculator keyboard activation and nested document task/result behavior. Scoped
component fixtures at 390/1024 px content widths have no horizontal overflow,
responsive grids collapse from two columns to one, large buttons measure 48 px
high, and light/dark themes render correctly. This is content-width qualification,
not a repeat of the whole conversation shell at a mobile viewport. Generation examples and the integration checks below complete commits B and C.

Local entry points (repository-relative):

- `YellowStorm/front/src/modules/conversation/components/openui/`: library.tsx,
  MiniApp.tsx, mini-app-definitions.ts, mini-app-functions.ts, OpenUiAnswer.tsx,
  use-mini-app-state.ts, mini-app-task.tsx and mini-app-task-context.ts.
- `YellowStorm/front/scripts/generate-openui-prompt.mjs` and generated backend prompt.
- Existing conversation message/file controllers and conversation-agent-request.builder.ts.
- [Private-state ADR](../decisions/ADR-0025-openui-private-draft-state.md),
  [current implementation/phases](openui-mini-apps-plan.md).

Official/upstream evidence:

- [OpenUI component and library API](https://www.openui.com/docs/openui-lang/defining-components)
- [Official shadcn design-system example](https://www.openui.com/docs/openui-lang/examples/design-systems/shadcn)
- [Demo library](https://github.com/thesysdev/open-intelligent-ui/blob/03213439358bf3408ad61a46ec9e3230c5572e48/src/lib/library.ts)
- [Layouts](https://github.com/thesysdev/open-intelligent-ui/blob/03213439358bf3408ad61a46ec9e3230c5572e48/src/lib/components/layout.tsx),
  [controls](https://github.com/thesysdev/open-intelligent-ui/blob/03213439358bf3408ad61a46ec9e3230c5572e48/src/lib/components/controls.tsx),
  [theme](https://github.com/thesysdev/open-intelligent-ui/blob/03213439358bf3408ad61a46ec9e3230c5572e48/src/lib/components/theme.css),
  [style boundary](https://github.com/thesysdev/open-intelligent-ui/blob/03213439358bf3408ad61a46ec9e3230c5572e48/src/lib/components/style.ts),
  [generation examples](https://github.com/thesysdev/open-intelligent-ui/blob/03213439358bf3408ad61a46ec9e3230c5572e48/src/lib/prompt-options.ts)
- [Upstream license](https://github.com/thesysdev/open-intelligent-ui/blob/03213439358bf3408ad61a46ec9e3230c5572e48/LICENSE)

## Generation guidance qualification (2026-10-18)

The existing shared generator now emits four composition patterns using the mounted
Mini* vocabulary. Simple requests select a compact direct-manipulation tool,
responsive assumptions/results workflow, search/list or explicit document task.
Guidance covers width, hierarchy, semantic button roles, labels, null/zero handling,
reset and user language. No new runtime, dependency, service, schema or app-specific
screen is introduced. Legacy program examples remain compatibility fixtures.

The prompt is 54,999 characters (55k soft target, 60k hard cap). Redundant stock
examples/instructions were condensed while retaining citation, image, report,
presentation, state and document-access contracts. All examples parse against their
actual target libraries. Focused frontend tests: 45 PASS; backend enabled/disabled
prompt assembly: 3 PASS. Production TypeScript check: PASS.

Live GPT 6 Luna checks use simple user requests without component names. A fresh
calculator generated a composed keypad and retains local 2+3=5 after full reload
with the same source message and usage. Fresh estimator/shortlist apps retain price
0, quantity 3, discount true and query osa/Osaka after full reload with unchanged
message IDs/usage. The summarizer generated an empty required document selector,
explicit disabled-until-selected action and saved-result panel; its unsubmitted
DOCX/Detailed selection survives full reload without inference.

The explicit DOCX run produced a grounded Willow summary (Tuesday, Lina, EUR 120,
two-team review). After full reload, the new source app restores that actual saved result and
DOCX/Detailed settings with the same task/answer IDs and 1.2M usage; no agent rerun. Existing document access/CAS boundaries were not changed by this
prompt-only phase. Independent source review accepts the guidance and examples.
Generation remains model-dependent; these four checks qualify the tested model and
requests, not every possible app. Calculator example scope is an integer keypad,
not a full scientific calculator. Dynamic private-state exports remain phase 5.

## Integration qualification (2026-10-18)

ADR-0025 remains the governing private-state identity/CAS contract; document and
MCP authorization under ADR-0017/0018 is unchanged. No schema, service, runtime or
export format was added. This phase fixes the accepted-submission fallback in
OpenUiAnswer: when there was no private draft, it previously combined submissions
from any participant and could reuse an older task program. Mini-app fallback now
requires the current actor and, for versioned task submissions, the current program
digest. Same-actor legacy submissions without task metadata remain compatible;
ordinary accepted form/table/chart views retain their existing shared behavior.

Three focused regressions reproduce both foreign-actor and old-digest hydration
before the fix (two failures, one positive compatibility pass), then all pass after
it. The private-state database was already actor-scoped; this was a frontend
hydration defect, not cross-user database reads or a file-storage isolation leak.

| Boundary | Outcome and evidence |
| --- | --- |
| Database concurrency and identity | PASS: 161 backend tests across nine suites, including five real PostgreSQL tests in a separate test DB. Concurrent create/update admits one revision winner, separate actors/apps retain exact typed drafts, removed members cannot update prior drafts, changed sources get a new digest/revision zero and reject old writes. |
| Frontend privacy and persistence | PASS: 148 distinct focused frontend tests across 13 suites, plus TypeScript. Covers late responses, typed null/zero/false/empty values, conflict/retry, explicit task flush, actor/program fallback, document/result remounts and existing export pipelines. |
| Live conflicting tabs | PASS on the estimator/shortlist fixture: stale 22 cannot overwrite saved 11. Load saved restores 11. A second stale 23 is saved only after explicit Reapply; reload/reopen retains 23 and computed 62.10, query osa, quantity 3 and discount true. Source IDs and 21.3K usage remain unchanged. |
| Live two-user boundaries | PASS: distinct English AG and French ZZ sessions each reject the other's private conversation. ZZ also cannot open the document-summary conversation. Its own fresh budget retains 77 x 2 = 154 after full reload with the same source and 20.8K usage. Shared-conversation private actor state is independently exercised by real PostgreSQL tests. |
| Document results | PASS: the original reader restores selected scan/Short and actual Maple/Saturday/Rami result after reload/reopen without inference; unchanged 1.2M conversation usage. A second stored app with changed inputs correctly shows stale while the original full Willow answer remains available. Cancelled-result JSON roundtrip/remount is covered automatically and never shows partial success or executes an action. |
| Existing exports | PASS: cold-loaded saved table filter a, Visits ascending and chart Visits/Osaka zero are preserved in downloaded DOCX and HTML. Both contain Osaka 0/600 then Paris 2/900, a rendered chart and no raw program. After full reload the Japan deck downloads PDF (four 960x540 pages, one image each) and image-based PPTX (four slides, one picture each). PDF pages visually inspected; titles/photos/text remain present. Image/report projection and missing-asset failure tests also pass. |

Live fixtures: estimator `08bf56543d83bc5564b521f1`, second-user budget
`f26e98d063b0df1da697db79`, document reader `f417e12e499dba83ffe99d10`,
saved table/chart `c73786bee4cbcf72d2c23bae`, Japan `4e08cbf1405b0f44f76eb7f5`.
Current downloads: Friendly-Greeting-Exchange-2026-10-17 (4).docx (22,364 bytes),
(3).html (32,436 bytes), Japan-A-First-Trip-Guide-2026-10-17 (2).pdf (2,912,008 bytes)
and (2).pptx (3,676,304 bytes). Export filenames use the existing UTC date behavior.

The first account required sign-in after its session expired; checks resumed in
the same QA context. No credentials were saved in source, tests or evidence.
This qualifies existing static exports, not private dynamic-app snapshots or a new
MCP editable-PPTX execution run. Those remain separately scoped. The live second
user had a private conversation; shared-conversation actor-draft checks use the
real database tests rather than an unapproved sharing/permission change.
