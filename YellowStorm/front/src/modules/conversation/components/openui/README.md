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
- `continue_conversation` actions (buttons, forms, follow-ups) are sent as a user message through
  `useConversationStore.sendMessage`, with submitted form values appended as readable field/value lines. `open_url` opens http(s) links only.
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
Names, schemas and prompt are unchanged (spec-equality test). Each known marker becomes our `SingleInlineCitation` chip (hover
card, document viewer, record drawer, web link). Components that render plain strings (Tag, TagBlock, ImageText, MetricIndicator*,
FollowUpBlock texts, Steps/Tabs/Accordion headings, SectionBlockItem and tab/accordion triggers, chart labels, Col labels,
buttons) show the marker literally or drop it; the prompt tells the agent to avoid them. A `CardSourceProvider` gives the stock inline
markdown a fallback source widget instead of dropping a marker. Unknown markers stay literal text; citations the text never marks
are listed after the answer, like markdown. The sources menu in the message actions works from the stored components and needs nothing here.
`scripts/generate-openui-prompt.mjs` adds the rules that teach the agent this (markers only inside the components above,
copied verbatim, no sources list, no `sources` on Card). Re-run `npm run openui:prompt` and commit the generated back-end module after changing them.

## Copy and export

An OpenUI answer is stored as a program, so copy / HTML / DOCX / PDF export read the rendered answer back from the DOM
(`plain-text.ts`: blocks become lines, table rows `a | b`, citation chips `[n]`, charts omitted). When the message is not
rendered the stored text is used unchanged. A folded `SectionBlock` unmounts its closed sections, so when one is closed the DOM is
not the whole answer and the projection falls back to the program strings (without table cells).
A report lives in its panel, not in the message, so its text always comes from the program strings (`programToPlainText`), appended after the rendered answer.
