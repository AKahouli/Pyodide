# OpenUI render mode

An agent can answer in [OpenUI Lang](https://www.openui.com/docs) instead of markdown. OpenUI Lang is plain text in the usual
`text` component of the NestJS SSE stream (the Python ADK runtime is unchanged), rendered here.

## The per-agent toggle

Each agent has a **Generative UI** toggle (`genUiEnabled`, agent edit form; personal agents and admin default agents). It is ON
for newly created agents; the migration `0048_agent_gen_ui` set existing agents OFF, except those whose slug starts with
`openui-` (the old spike convention, now irrelevant).

ON does two things:

1. **Back end** (`AgentService.buildAgentsForStream`): appends the OpenUI output-format block to the prompt it builds from the
   agent's own pre-prompt and DB instruction (`appendGenUiOutputFormat`, back/src/modules/agent/prompts). The agent's own prompt
   stays in the database; code only adds the format block. Playbook, A2A and agent-task prompts are not touched.
2. **Front end**: `resolveAnswerRenderMode` (render-mode.ts) returns `openui` when the producing agent has `genUiEnabled` and the
   build has `VITE_OPENUI_RENDER_ENABLED=true` (global kill switch; off = markdown everywhere and the OpenUI chunk is never
   requested). The agent comes from the agents already in the store, so there is no per-message lookup.

Answers keep the form they were produced in: a stored text that starts with `root = Card(` or `root = Report(` is rendered as an
OpenUI program even after the toggle was switched off, and a markdown answer of an agent switched on later falls back to markdown
inside the renderer.

## The output-format prompt

`scripts/generate-openui-prompt.mjs` builds the block from the library we render and writes the committed module
`back/src/modules/agent/prompts/openui-output-format.generated.ts` (plus a plain-text copy in `scripts/generated/`, git-ignored):

```bash
cd YellowStorm/front
npm run openui:prompt                              # regenerate after changing rules/examples or upgrading @openuidev/*
node scripts/generate-openui-prompt.mjs --check    # exits 1 when the committed module is stale (also run by prompt-freshness.test.ts)
```

Commit the regenerated module together with the change. The block is no longer pasted into an agent instruction (so the 50,000
character instruction limit does not apply to it); an agent such as `openui-experiment` only keeps its own role text.

## Component library

### OpenUI 1.0 migration

The frontend pins `lang-core`/`react-lang` to **1.0.1** and `react-ui`/`react-headless` to **0.18.1**.
Thesys remains **0.14.0**: its published peer ranges do not certify this combination. Existing package overrides retain one
SDK runtime and the application's Zustand 5 store; mounted legacy component/provider tests qualify this integration locally.
Keep these tests as upgrade gates, including reports, slide previews, forms, images and exports. React remains 18.

The phase 1 dependency migration preserved existing component signatures, persisted programs and accepted interaction state.
Its generated prompt was unchanged. `migration-compatibility.test.tsx` separately qualified the 1.0 function, local `@Set`,
typed action and state-hydration APIs before phase 2 exposed the bounded declarative primitives below. Autosave remains separate work.

Known upstream limitation: core 1.0.1's `library.extend()` calls `zod/v4/core.util.mergeDefs`, which is absent from Zod
3.25.76's bundled v4 bridge. Vite warns about that export. Our libraries and prompt generator use `createLibrary` with
complete definitions, so the affected extension path is not invoked. Do not adopt `library.extend()` without qualifying
a compatible scoped Zod dependency and an extension regression; upgrading the application's Zod 3 forms is separate work.

The renderer uses the **thesys chat library** (`chatLibrary` of `@openuidev/thesys`): the root is `Card`, answers can use
`SectionBlock`, `Tabs`, the card blocks, `InlineHeader`, `List`, charts, and end with a `FollowUpBlock` (its texts raise a plain
`continue_conversation` action, sent as a user message like a button). It runs on our `react-lang` and `react-ui`: package.json
overrides pin thesys's peer ranges (`^0.3`, `^0.14`, `zustand ^4`) to the versions we use, so there is one copy of each.
`Card` is overridden (library.tsx): the stock one opens its own source context and renders a Sources strip from its
`sources` argument; ours keeps the answer's citations and ignores `sources`. The prompt (generate-openui-prompt.mjs) drops
that argument from the spec.

`@openuidev/thesys` (0.14) exports no prompt options for `chatLibrary` or `reportLibrary` (its own examples and rules stay private to the
package; the ones in `@openuidev/react-ui` target its own library with other signatures). The generator therefore builds the prompt with
`generateSystemPrompt` from the stock spec and layers our own `additionalRules` (stat cards, charts, icon lists, tags, image cards, citations,
reports) and `examples`, each example parsed against the library at generation time.

### Reusable declarative mini-apps (phase 2)

The agent composes `MiniApp`, `MiniInput`, `MiniSelect`, `MiniToggle`, `MiniButton`, `MiniOutput` and `MiniList` inside the
existing `Card` root. These are general controls, not calculator, scenario or summarizer screens. Inputs bind directly to
OpenUI `$variables`; native expressions and local `@Set`/`@Reset` actions update the panel without an inference turn.
Numeric blank is `null`, distinct from zero. Required fields and numeric ranges are checked before `AskAgent` even when the
generated button omits its validation flag. Fields disable during streaming/submission; existing submission status and retry
handling are reused. Local reset does not require the form to be valid.

Four registered pure functions support composition: `FormatNumber`, `TextMetrics`, `FilterText` and `JoinText`.
Every implementation validates both arguments and results internally: the SDK's declared schemas alone do not reliably
enforce refinements at execution time. Numbers must be finite, decimal precision is 0–12, lists contain at most 200 strings,
and combined function text is limited to 20,000 UTF-16 code units. Join separators have at most 100 code units and joined
output is bounded too. Invalid calls throw into the SDK's isolated error path and become `null`; `MiniOutput` shows the
localized invalid/empty-result message while valid sibling output remains visible. Text input controls cap each value at
5,000 code units. There is no model-supplied JavaScript, `eval`, HTML execution or direct tool/file capability.

`AskAgent(instruction, inputs)` is an explicit action, normalized to the existing typed `continue_conversation` submission.
Bounded JSON inputs and binding state retain numbers, booleans, arrays, null and empty strings. The existing backend verifies
the source answer/component and conversation access, then places the canonical typed submission in an ordinary agent turn.
A document summarizer therefore uses pasted text or names a document already authorized in that conversation/workspace;
the conversation agent reads it with its existing tools and answers separately. Missing or inaccessible documents require
an attachment or clarification. `TextMetrics` only counts text; it does not summarize documents. No document picker,
new execution bridge or in-place asynchronous result service was added.

Phase 2 initially restored only accepted submissions. Phase 3 adds private autosave for completed `MiniApp` programs:
the host loads actor/source/program-scoped state before enabling controls and saves changes after a 500 ms debounce.
Unsubmitted numbers, booleans, null, empty strings, arrays and objects retain their JSON types. The existing accepted
submission state remains the fallback when no private draft exists. Quiet saves never invoke the agent.

The authenticated GET/PUT endpoint under `messages/:messageId/openui/:componentId/state` derives actor and source digest
server-side; both operations require creator/member access. Atomic expected revisions reject stale writes. The host verifies
SHA-256 of the exact saved program and scopes late responses to the actor/source. Saving, saved, retry, read-only and conflict
states are visible. Conflicts require loading saved state or explicitly reapplying a draft against the current revision.
Dynamic mini-app snapshot exports remain deferred. Export requests can produce a separate static answer/report or authorized
artifact through the existing agent. See ADR-0025 and the phase plan for the persistence contract and qualification evidence.

The generator transpiles the exact shared TypeScript definitions with the installed TypeScript dependency for Node 20,
enables bindings and disables tool calls. The phase 4 prompt is 54,867 characters (55,000 soft target; 60,000 hard cap).
Phase 2 qualification covers four unrelated generated compositions and an explicit document-summary request: the frontend run passes 251 tests in 31 files, including the 12 function/mounted tests, and the final production build passes.
Live browser QA in conversation `0a36aab51f702536578737aa` generated all four apps from one natural-language request:
100 Celsius displayed 212.00 Fahrenheit, reset restored 32.00, the discounted scenario displayed 18.00, and `Os` filtered
the list to Osaka without another assistant turn. An explicit summary request with Detailed/French/bullets=false produced
a grounded French answer, including the source's zero-euro budget. Controls disabled while submitting. After changing the
source to an unsubmitted draft and reloading, the accepted original source, Detailed/French/false choices and summary returned;
the scenario/list bindings captured in that accepted submission also restored. A downloaded 1,176-byte static HTML summary
retained the title, paragraphs and zero-euro fact. Final TypeScript and 14 backend contract tests pass. Independent implementation
and documentation review found no blocking issues.

thesys's stylesheet is imported next to the react-ui one in OpenUiRenderer.tsx. Both live in the lazy chunk, and
`devtools-off.ts` must stay the first import of anything that loads react-lang (thesys does, so a new entry point has to import it first).

## Reports

The model can add a report to an answer: after the Card program, a blank line and a second program that starts with its own
`root = Report(` line (the thesys report library; its components share names with chat ones under different schemas, so the two
are parsed separately). `report-program.ts` cuts the answer at that line; OpenUiRenderer renders the first part with
`openUiLibrary` and the second with ReportBlock.tsx.

In the message the report is thesys's own chip (title, "Report", View button). The thesys `Report` is an *artifact component*: it
renders the chip and, when opened, portals the full viewer into the node registered by the host's detailed-view store (the
design of `AgentInterface`). We keep that design and supply the two things it needs, instead of wrapping `<Report>` ourselves
(which would need a different root, `ReportView(title, subtitle, pages)`, and a rewrite of the program):

- `ChatProvider` (react-headless, a direct dependency) with an inert LLM, because the viewer reads the chat store;
- our own panel store (`report-panel-store.ts`, Zustand, same shape as react-headless's detailed-view store) provided through
  `DetailedViewContext`. The chip opens a view by id; `ReportPanelSidebar` (in ConversationPage and GroupConversationPage, next
  to `FileViewerSidebar`) registers the portal node and shows the viewer. The ids are scoped by message and part, so two
  reports never share a panel.

The panel closes with its button, Escape, or a conversation change. Opening a report closes a file viewer in sidebar mode, and a
file viewer opening in the sidebar closes the report (one right-hand slot). Under 768px the panel is a full-screen overlay.
Its title and button go through the `conversation` locale (`openui.report.*`). The viewer's Edit button is hidden: nothing would store the edit.

Citations: the report text is rendered by editable rich-text blocks that cannot carry our chips, so `[n]` markers inside a report
stay literal. The sources a report marks (and the chat text does not) are listed under its chip. Making the report text chip-aware
would mean overriding each report component, which is not done.

## Behaviour

- Each assistant text part is rendered as its own OpenUI program (a tool call between two texts starts a new `root = ...`).
  Non-text parts (choices, sources, artifacts) keep their regular renderers.
- While streaming the Renderer is given `isStreaming`; the program is parsed incrementally.
- `continue_conversation` actions retain bounded typed form values and parameters in saved `openUiSubmission` metadata through
  `useConversationStore.sendMessage`. Chat bubbles show a readable action label; accepted values hydrate the renderer after reload. `open_url` opens http(s) links only.
- Named primitive-cell chat tables support filtering, numeric/string column sorting and original row selection.
  Apply table view saves `TableView` values under the existing interaction's `__ysExplore` form; drafts remain local.
  Exports use the last applied view, including selected rows (or all filtered rows when none are selected), independent of mounted DOM.
  Answer export fetches saved message pages so older accepted selections remain available after reload.
- Named chat bar, horizontal bar and line charts provide series/category selectors and category drill-down buttons.
  Apply chart view saves original series/category indices as typed `ChartView` values in that same interaction form.
  All series/categories remain visible by default; applying a selection drives reload and export projection, including numeric zero.
  Report/presentation chart schemas and unsubmitted draft persistence are unchanged.
- Download actions resolve a unique ready artifact attached to the same answer and request a fresh authorized download URL on click, including after reload. Model-authored sandbox paths are never fetched directly.
- A load or render failure falls back to the markdown renderer for that text part.
- `toolProvider`, `AgentInterface` and `fetchLLM` are deliberately not used.

## Look, theme and dev tooling

- Typography is stepped down for the chat bubble (16px body becomes 14px, headings in proportion) through the OpenUI
  theme tokens (`theme.ts`), injected only under `[data-openui-scope]`. Light/dark follows the app theme setting
  (`ThemeProviderContext`; "system" resolves through the media query).
- `devtools-off.ts` sets react-lang's once-only guard flag so its development inspector (fetched from cdn.jsdelivr.net,
  blocked by the CSP) is never mounted. Keep it the first import of any module that loads `@openuidev/react-lang`.
- `preload.ts` warms the lazy chunk when a generative UI agent is tagged, is the conversation's agent, or a stream start
  names it.

## Citations

Tools return numbered markers (`[1]`, `[2]`) and the citation components attach to the text part whose content contains
the marker, exactly as for markdown answers. The stock library renders every string through a markdown block that has no hook,
so `library.tsx` swaps the renderer of the text-bearing components, using the stock markup and class names (the `c1-*` rules apply
unchanged): TextContent is reimplemented around `CitationMarkdown`; Header and Table keep the stock component and are fed chip
elements (or a marked cell resolved by `renderNode`); CalloutV2, StepsItem, Text, BoldText, IconText (the text of every card block),
InlineHeader, List and EntityList are in `inline-text.tsx`, used only when a string carries a `[n]` marker and the answer has citations.
Stock component names and schemas remain unchanged; the library adds the separate mini-app definitions and their prompt spec.
Each known marker becomes our `SingleInlineCitation` chip (hover
card, document viewer, record drawer, web link). Components that render plain strings (Tag, TagBlock, ImageText, MetricIndicator*,
FollowUpBlock texts, Steps/Tabs/Accordion headings, SectionBlockItem and tab/accordion triggers, chart labels, Col labels,
buttons) show the marker literally or drop it; the prompt tells the agent to avoid them. A `CardSourceProvider` gives the stock inline
markdown a fallback source widget instead of dropping a marker. Unknown markers stay literal text; citations the text never marks
are listed after the answer, like markdown. The sources menu in the message actions works from the stored components and needs nothing here.
`scripts/generate-openui-prompt.mjs` adds the rules that teach the agent this (markers only inside the components above,
copied verbatim, no sources list, no `sources` on Card). Re-run `npm run openui:prompt` and commit the generated back-end module after changing them.

## Copy and export

Copy reads mounted content with a stored-program fallback. Document exports parse the saved program, including folded
sections and reports, and hydrate only accepted table/chart submissions from message history. DOCX, HTML and PDF share
`buildStructuredExportBlocks`: charts are rendered offscreen with the native stock chart under an isolated light theme,
then captured as embedded PNGs including legends. The applied chart subset and filtered/sorted table are used; local
unsubmitted edits never affect exports. The editable chart data table and metadata remain alongside the chart image.
Capture failure fails the export explicitly. Captures do not depend on virtualized/mounted answer DOM or execute actions.
MCP manifests retain their existing chart metadata and editable data tables without raster capture.

Phase 3 qualification: 264 distinct frontend tests and 23 backend tests pass, including real PostgreSQL isolation/concurrency checks. Production TypeScript checks pass. Live four-app drafts retain typed unsubmitted values after reload; two tabs detect stale writes and recover through load/reapply without inference. Independent source and documentation review passes.

## Reusable composition and theme

`MiniRow`, `MiniColumn`, `MiniGrid`, `MiniPanel` and `MiniText` compose arbitrary
mini-app layouts without introducing another form or state owner. These adapt
the upstream demo's layout algorithms and hierarchy; revision/license attribution
is in `MINI-APP-NOTICE.txt`. All styles are scoped and use YellowStorm theme tokens.
Spacing uses bounded 4px steps. Grid columns are 1–6, optional minimum child width
is 80–640 px, and each layout accepts at most 40 direct children. Runtime numeric
clamps supplement schema limits. Responsive grids shrink their column count;
omitting minimum width supports a fixed keypad.

Existing positional calls retain their defaults. Optional trailing MiniApp width
is compact/medium/full. MiniButton adds solid/outline/soft/ghost appearance,
sm/md/lg size, a finite icon name, disabled/block flags and md/lg/full radius after
its existing validate argument. MiniOutput adds body/display/compact size and
start/center/end alignment. MiniText offers heading/body/caption/display roles
and citation-aware text. Local actions remain local, document tasks stay explicit,
and layouts preserve private autosave and saved-result identity. New programs do
not migrate old private drafts across program digests. Static MiniText fallback
projection retains text while excluding presentation enums; dynamic app snapshots
remain the separately scoped export phase.

The generated prompt exposes exactly these schemas. Full worked generation
examples and broader visual qualification remain the next migration-map commit.

## Document tasks (phase 4)

`MiniDocument(name, label, $documentId, required)` lists completed conversation
uploads through the authenticated conversation-files API. Composer upload
and refresh reuse the normal limits; IDs, names and storage URLs are never invented
by the generated program. Linked external workspaces are not added to this selector.

`AskAgent(instruction, inputs, documentIds?)` explicitly runs the existing agent.
The host flushes private state, sends a versioned source digest/revision descriptor,
and preserves the request ID on uncertain retries. Backend source/member/file checks
precede execution. Busy guards block double clicks; later explicit reruns get a new ID.

`MiniTaskResult(label, inputs)` follows the actual stored user/assistant message link
for the enclosing app and signed-in actor. It restores saved text without executing
an action. Its inputs should match AskAgent. Host revision and dirty-state checks
also mark any changed component snapshot stale, even when generated inputs omit a
changed field. Cancelled/failed/interrupted partial output is not a completed result.
The normal conversation answer retains its full content and export actions; dynamic
mini-app snapshot export remains phase 5. No result body is stored in private drafts.

### Generation composition guidance

The shared prompt now demonstrates four task-shaped compositions: compact keypad,
responsive estimator, searchable shortlist and document workflow. These are example
programs, not host screens or a closed app catalog. Definitions still come from the
mounted library; the generator parses every example before writing the backend
module. Legacy examples remain acceptance fixtures for existing signatures.

Document generation uses MiniDocument with an empty initial ID, explicit validated
AskAgent and a MiniTaskResult with matching typed inputs. The host owns private
autosave/status, access checks and saved-result correlation. Generation must not
invent documents, automatically summarize, write results into drafts or recreate
the source app when answering a task. Static answer exports remain supported;
private dynamic snapshots remain the separately scoped phase 5.
