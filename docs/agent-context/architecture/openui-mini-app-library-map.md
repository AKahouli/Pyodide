# OpenUI mini-app library reuse and migration map

Status: **composition/theme implemented and qualified; generation guidance and remaining integration phases proposed**.
Assessed 2026-10-17; composition phase authorized 2026-10-17.
Scope: polished, reusable mini-apps in Conversation v1. A generated-code sandbox
remains separately scoped.

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

| Separate proposed commit | Work | Observable acceptance |
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
not a repeat of the whole conversation shell at a mobile viewport. Commit B's broader
generation examples and commit C's remaining qualification retain their scope.

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
