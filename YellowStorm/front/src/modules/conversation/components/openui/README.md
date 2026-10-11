# OpenUI render mode (phase-1 spike)

An agent can answer in [OpenUI Lang](https://www.openui.com/docs) instead of markdown. The Python ADK runtime and the
NestJS SSE stream are unchanged: OpenUI Lang is plain text in the usual `text` component, rendered here.

## How the front decides

`resolveAnswerRenderMode` (render-mode.ts) returns `openui` only when **both** hold:

1. the build has `VITE_OPENUI_RENDER_ENABLED=true` (off by default; the OpenUI chunk is never requested otherwise);
2. the agent that produced the answer has a `slug` starting with `openui-`.

Anything else renders markdown, exactly as before. `slug` is already part of every `Agent` the front receives, so no
backend contract changed. If the spike graduates, replace the slug convention with an explicit `renderMode` field on the
agent config (DTO, Mongo/Drizzle mapper, `Agent` type).

## Register the `openui-experiment` agent

1. Generate the prompt (needs `npm install` first):

   ```bash
   cd YellowStorm/front
   npm run openui:prompt            # writes scripts/generated/openui-system-prompt.txt (git-ignored)
   node scripts/generate-openui-prompt.mjs - > prompt.txt   # or print to stdout
   ```

2. In the agent library create an agent:
   - **Name**: `openui-experiment` (the slug is derived from the name; keep the `openui-` prefix).
   - **Instruction**: paste the generated prompt (about 31k characters, under the 50,000 limit; re-generate after upgrading `@openuidev/*`).
   - **Ignore pre-prompt**: on, so the platform pre-prompt does not ask for markdown.
   - Pick a capable model; no tools or knowledge bases are required.
3. Start the front with the flag: `VITE_OPENUI_RENDER_ENABLED=true npm run dev`, open `#/conversation`, tag or select the
   agent and ask for e.g. "a table of the three largest EU economies with a bar chart".

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
  `useConversationStore.sendMessage`, with submitted form values appended as JSON. `open_url` opens http(s) links only.
- A load or render failure falls back to the markdown renderer for that text part.
- `toolProvider`, `AgentInterface` and `fetchLLM` are deliberately not used.

## Look, theme and dev tooling

- Typography is stepped down for the chat bubble (16px body becomes 14px, headings in proportion) through the OpenUI
  theme tokens (`theme.ts`), injected only under `[data-openui-scope]`. Light/dark follows the app theme setting
  (`ThemeProviderContext`; "system" resolves through the media query).
- `devtools-off.ts` sets react-lang's once-only guard flag so its development inspector (fetched from cdn.jsdelivr.net,
  blocked by the CSP) is never mounted. Keep it the first import of any module that loads `@openuidev/react-lang`.
- `preload.ts` warms the lazy chunk when an `openui-` agent is tagged, is the conversation's agent, or a stream start
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
copied verbatim, no sources list, no `sources` on Card). Re-run `npm run openui:prompt` and re-paste the instruction after changing them.

## Copy and export

An OpenUI answer is stored as a program, so copy / HTML / DOCX / PDF export read the rendered answer back from the DOM
(`plain-text.ts`: blocks become lines, table rows `a | b`, citation chips `[n]`, charts omitted). When the message is not
rendered the stored text is used unchanged. A folded `SectionBlock` unmounts its closed sections, so when one is closed the DOM is
not the whole answer and the projection falls back to the program strings (without table cells).
A report lives in its panel, not in the message, so its text always comes from the program strings (`programToPlainText`), appended after the rendered answer.
