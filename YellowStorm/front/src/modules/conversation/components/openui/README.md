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
   - **Instruction**: paste the generated prompt (about 36k characters; re-generate after upgrading `@openuidev/*`).
   - **Ignore pre-prompt**: on, so the platform pre-prompt does not ask for markdown.
   - Pick a capable model; no tools or knowledge bases are required.
3. Start the front with the flag: `VITE_OPENUI_RENDER_ENABLED=true npm run dev`, open `#/conversation`, tag or select the
   agent and ask for e.g. "a table of the three largest EU economies with a bar chart".

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
the marker, exactly as for markdown answers. The stock library hard-wires its markdown block into each component and offers no hook, so `library.ts` (now `library.tsx`) swaps the renderer of the text-bearing ones: TextContent, MarkDownRenderer and Callout are reimplemented around `CitationMarkdown`; Steps, CardHeader and Table keep the stock component and are fed chip elements (or a marked cell resolved by `renderNode`). Names, schemas and prompt are unchanged (spec-equality test). Each known marker becomes our `SingleInlineCitation` chip (hover card, document viewer, record drawer, web link). Components that render plain strings (ListItem, Tag, chart labels, buttons) show the marker literally; the prompt tells the agent to avoid them. Stock inline-markdown components (InlineHeader, text blocks) parse `[n]` themselves, so a `CardSourceProvider` gives them a fallback source widget instead of dropping the marker. Unknown markers stay literal text; citations the text never marks are listed after the answer, like markdown. The
sources menu in the message actions works from the stored components and needs nothing here.
`scripts/generate-openui-prompt.mjs` adds the rules that teach the agent this (markers only inside `TextContent`,
copied verbatim, no sources list). Re-run `npm run openui:prompt` and re-paste the instruction after changing them.

## Copy and export

An OpenUI answer is stored as a program, so copy / HTML / DOCX / PDF export read the rendered answer back from the DOM
(`plain-text.ts`: blocks become lines, table rows `a | b`, citation chips `[n]`, charts omitted). When the message is not
rendered the stored text is used unchanged.
