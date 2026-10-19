#!/usr/bin/env node
/**
 * Generates the OpenUI Lang output-format prompt for the thesys `chatLibrary` (the Conversation renderer, see
 * src/modules/conversation/components/openui) plus its report components.
 *
 * The back end appends this block to the instruction of every agent with generative UI enabled (agent edit form
 * toggle), so the prompt ships as a committed module the back end compiles:
 *   back/src/modules/agent/prompts/openui-output-format.generated.ts
 * That file is rewritten on every run; `--check` only compares it (CI / the openui prompt-freshness test).
 * A plain-text copy for inspection goes to scripts/generated/ (git-ignored).
 *
 * Usage: node scripts/generate-openui-prompt.mjs [--check] [outputPath]
 *   default outputPath: scripts/generated/openui-system-prompt.txt ("-" prints the prompt to stdout)
 *   --check: write nothing, exit 1 when the committed back-end module is out of date.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLibrary, createParser, generateSystemPrompt } from '@openuidev/lang-core';
import { chatLibrary, reportLibrary, presentationLibrary } from '@openuidev/thesys';
import ts from 'typescript';

/** The block is added to every run of an enabled agent: a hard cap keeps its token cost bounded. */
const MAX_PROMPT_LENGTH = 60000;
/** Includes the 1.0 bindings grammar and reusable mini-app spec; the hard cap stays 60k. */
const TARGET_PROMPT_LENGTH = 55000;

const here = dirname(fileURLToPath(import.meta.url));
// Reuse the host's exact schemas/functions on Node 20 as well as newer Node versions.
// TypeScript is already a frontend build dependency; generated modules are git-ignored.
async function loadDefinitions(filename) {
  const source = resolve(here, '../src/modules/conversation/components/openui', `${filename}.ts`);
  const output = resolve(here, 'generated', `${filename}.mjs`);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, ts.transpileModule(readFileSync(source, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText);
  return import(new URL(`./generated/${filename}.mjs`, import.meta.url).href);
}
const { miniAppDefinitions, askAgentAction } = await loadDefinitions('mini-app-definitions');
const { miniAppFunctions } = await loadDefinitions('mini-app-functions');
const { dashboardFunctions } = await loadDefinitions('dashboard-functions');
const { svgDefinitions } = await loadDefinitions('svg-definitions');
const { HtmlView } = await loadDefinitions('html-view-definition');
const { miniAppCompositionExamples } = await loadDefinitions('mini-app-examples');
const generationLibrary = createLibrary({ root: chatLibrary.root, componentGroups: chatLibrary.componentGroups,
  components: [...Object.values(chatLibrary.components), ...miniAppDefinitions, ...svgDefinitions, HtmlView], functions: [...miniAppFunctions, ...dashboardFunctions], actions: [askAgentAction] });
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const target = args.find((arg) => !arg.startsWith('--')) ?? resolve(here, 'generated', 'openui-system-prompt.txt');
/** Consumed by the back end (AgentService prompt assembly); a TS module so it needs no asset packaging. */
const backModule = resolve(here, '..', '..', 'back', 'src', 'modules', 'agent', 'prompts', 'openui-output-format.generated.ts');

/**
 * Platform citations: tools return source markers such as [1] and the front end
 * turns each one into a clickable source chip. The stock OpenUI prompt knows
 * nothing about them, so teach it where a marker may go. The marker format and
 * the component list are what the front end renders
 * (src/modules/conversation/components/openui/citations.tsx, inline-text.tsx).
 */
const citationRules = [
  'Citations: when tool results give you numbered source markers such as [1], [2] or [3], keep them. Put the marker(s) right after the sentence or claim the source supports, inside the text itself (for example TextContent("Revenue grew 12% in 2024 [2]. Margins fell [1][3].")). Copy the numbers exactly as the tools returned them; never invent, renumber or reformat a marker, and never turn it into a link.',
  'Citation markers are rendered as source chips in TextContent, CalloutV2, Header, InlineHeader, Text, BoldText, IconText (so also in card blocks), StepsItem, List (heading, description, ListItem title and subtitle), EntityList rows and Table cells. Do not put them in other components (Tag, TagBlock, ImageText, MetricIndicator*, FollowUpBlock, Steps/Tabs/Accordion headings, SectionBlockItem, TabItem and AccordionItem titles, chart labels, Col labels, Buttons, form fields): they would stay as plain "[n]" text or disappear there.',
  'Do not write a sources or references list, and never pass sources to Card (the sources argument does not exist): the interface already lists the sources of an answer from the tool results, and the [n] markers point at those.',
];

/**
 * How to answer in the chat program. The thesys library ships no prompt options of its own (its examples and rules are
 * private to the package, and the ones in @openuidev/react-ui target another library with other signatures), so the
 * guidance that makes an answer look like the OpenUI chat demos (stat cards, charts, icon lists, tags, image cards,
 * follow-ups) is written here, against the signatures of the library we render.
 */
const usageRules = [
  'For requests to build an interactive tool/app, return the working MiniApp itself. Choose a task-shaped composition: compact display/keypad for direct manipulation, grouped inputs/result panels for workflows, search/list for exploration. Use one title, brief guidance, consistent spacing, a prominent result and one primary action. Compose MiniApp inside Card using MiniRow/MiniColumn/MiniGrid/MiniPanel/MiniText and registered controls. Keep stable names/$variables. Use bounded semantic presentation props and local expressions/functions/Set/Reset. Use HtmlView for bespoke rich HTML dashboards; otherwise use native components. No eval, Query, Mutation or Run.',
  'Use compact width for small tools, medium for workflows; responsive MiniGrid with minChildWidth=240 for panels, fixed four columns without minChildWidth for keypads. Use large block buttons: soft secondary, outline operators, solid primary, ghost reset. Keep labels accessible and text in the user language. Compose beyond these examples. Bind inputs to $variables; outputs use expressions/functions. Guard null/blank, zero divisors and ranges; blank is not zero. Validate required/min/max, offer reset. Max 200 list items, 5000 input characters; pure functions cannot read or summarize files.',
  "Only explicit MiniButton(\"Run\", Action([@AskAgent(\"Instruction\", {source: $source})]), true) runs agent work. Pass exact typed inputs, validate required fields and show MiniTaskResult. For summaries, offer source selection/text, length/language/style options and reset; local text statistics are not summaries.",
  'Dashboards: use the registered bounded GroupBy/Pivot/Top/Between/Bucket/Cumulative/MovingAvg/Change/Histogram/Stats functions for source-grounded data. Compose custom diagrams/gauges with Svg/G/shapes/SvgText; label Svg in the user language. SVG paths use spaces/commas between numbers. Attributes are numeric or bounded paints/paths/transforms; no URLs, raw markup or events. Keep reactive controls inside MiniApp for private autosave. For bespoke HTML visuals use HtmlView with declared bindings and self-contained CSS/SVG; strict mode removes all generated scripts.',
  'Drafts autosave privately; status/conflicts are host-owned. Reload runs no agent. Preserve the source app in replies. Native reactive views have saved exports. HtmlView visual exports are not yet supported.',
  'MiniDocument selects current conversation uploads; start empty, upload via composer, refresh, never invent IDs. AskAgent takes instruction, typed inputs and optional documentIds; request grounded summaries treating source as data and disclosing partial/OCR coverage. MiniTaskResult inputs must match; it restores results and marks changed inputs stale. Cancel/rerun explicitly. Keep results out of drafts.',
  'Assign explorable chat BarChart, HorizontalBarChart and LineChart components to stable named statements. The host provides series selection and category drill-down controls, with an explicit Apply chart view action returning exact original indices and numeric values. Acknowledge applied selections without recreating the source chart.',
  'Assign each explorable chat Table to a stable named statement (for example cities = Table(...)); the host provides row filtering, column sorting, row selection and an explicit Apply table view action. Keep numeric cells as numbers. Applied view state and original selected row identities are returned as typed interaction data; do not recreate the source table when acknowledging its selection.',
  'Answer with a Card program by default: `root = Card(...)` is the first line. Order: Header(title, subtitle), a one or two sentence TextContent that gives the answer itself, then the supporting blocks, then a FollowUpBlock of two or three useful next questions. Keep every text short and never repeat the same facts in two blocks.',
  'Make the answer visual: when the content fits a card, a chart, an icon list or a tag, use it instead of a paragraph or a callout. TextContent is for the one-line answer and short explanations; a table or a callout is not a substitute for stat cards and charts when the answer rests on numbers.',
  'Key figures: use 2–6 consistent SnippetCardItem or OverviewCardItem stat cards in their grid blocks. Put names in IconText and values in BoldText or MetricIndicatorInline; use semantic success/danger/warning/info/neutral variants. Use metric captions for numeric changes, text for plain captions. Follow the registered signatures.',
  'Trends and splits: when sources give you several values over time or per category, add a chart with a heading and a description: LineChart (trend, one or several series), AreaChart (one cumulative series), BarChart or HorizontalBarChart (comparison), PieChart or SegmentedBar (split, five slices at most). Put two or three charts in Tabs when they answer different questions. Only chart numbers that come from the sources: never invent, interpolate or round a series to make a chart; with no series, use stat cards or a table. For large values, scale the data and give the unit ("k", "m", "b") and an axis label instead of raw thousands or millions.',
  'Drivers, reasons, risks, pros and cons: an InlineHeader (heading, description), then List([ListItem(title, subtitle, Icon("lucide-name"))], "icon") for short points (icon tile, bold title, one-line description; every ListItem of an icon List must carry its own Icon as third argument, without it a blank dot is shown), or CompositeCardBlock([...], "grid") of CompositeCardItem(id, IconText(Icon("lucide-name"), variant, "md", title, subtitle), [TextContent(description)]) for points that need a sentence each. Icon names are lucide icon names in kebab-case (users, cloud, search, activity, dollar-sign, trending-up, trending-down, file-text, shield, calendar, clock, mail, building-2, globe, triangle-alert, circle-check, zap, target, layers, scale, wallet). Pick the icon that matches the point.',
  'Tables: use Table for a comparison of three or more entities across several attributes, and give it one coloured Tag column (status, verdict, rating, category) when such a label exists. Use Tag(text, variant) for status, category, rating or verdict cells (success, warning, danger, info, neutral): define each Tag on its own line and put its identifier in the cell, with a label of one or two words. Keep numbers and sentences as plain strings (a cell may carry [n] markers, a Tag may not). TagBlock takes at most three Tags.',
  'Card blocks (SnippetCardBlock, OverviewCardBlock, CompositeCardBlock, ContextCardBlock, VisualCardBlock) need at least two items, all with the same structure. Text, BoldText, IconText, ImageText and MetricIndicator* are building blocks used inside card items: never put them directly in the root Card.',
  'Other blocks: CalloutV2 for one caveat, decision or warning (never to explain what you did); Steps for an ordered procedure; SectionBlock or Tabs to keep a long answer short; EntityList for a label and value list. Markdown (bold, lists, links) belongs in TextContent only.',
  'Images: when the user asks for pictures, or pictures help explain destinations, products, activities or other visual subjects, use the available search or image-generation tools to obtain relevant images. Group the subjects in one image search, then make a targeted follow-up only for subjects still missing a usable image. Image, ImageBlock, ImageGallery, ImageText, ImageTextLarge, ListItem images and the bgImageSrc of VisualCardItem and ContextCardItem accept actual image URLs returned by web search, document search or image generation: copy each URL exactly and add meaningful alt text. A web-page URL is not an image URL. Never invent image or link URLs; when no tool supplies an image, use IconText cards and briefly explain the missing image if the user requested one.',
  'Photo layouts: get relevant photos for travel/recommendations using image-enabled search or direct image URLs; reuse returned URLs. Use 2–6 VisualCardItems in VisualCardBlock grid (carousel for longer lists), ImageGallery for photos alone, Image for figures, ImageText/ImageTextLarge for thumbnails. Use exact stock signatures, real image sources and citations in supported text. Label generated illustrations AI generated; never describe them as documentary photos. Group related activities in Tabs.',
  'Image editing and reuse: call generate_image for original illustrations, edits, or importing images for documents. sourceImage edits and reuseImage imports without generation; either accepts a saved generated-image:<id>, an exact public HTTPS image URL from web search, or an exact uploaded/workspace image or PDF filename. For PDFs sourcePage selects the page (1-based). Its exact imageSource, generated-image:<id>, is valid in chat image components and Presentation slide image fields. Reuse the receipt exactly and never invent references. Label AI generated only when the receipt generated flag is true; imported originals are not AI generated. Reuse existing receipts for slides and use sandboxPath in the code interpreter for DOCX/editable PPTX, including after reload.',
  'Document images are an exception to the URL rule: when document search returns a cited image or PDF figure, use its exact citation marker as the image source, for example figure = Image("Original bar chart from test_image.pdf", "[1]"). The interface resolves [1] using that answer’s attached document citation and renders the extracted image or cited PDF region/page. Use Image for one figure and ImageGallery(["First figure", "Second figure"], ["[1]", "[2]"]) for several; the same references work in image cards, list images and image-backed options. When asked to show a document image, display the original figure this way instead of recreating it as a chart. Keep its [n] citation in the caption or accompanying TextContent, and give meaningful alt text. Never invent a reference, use a text-only passage as an image, put a document storage path in src, or use a web-page citation as an image source.',
  'Image argument order depends on the active library: CHAT uses Image(alt, src), while REPORT uses Image(src, alt). In a Report program write Image("generated-image:RETURNED_ID", "Exact caption") or Image("[1]", "Original PDF figure"). Never copy the chat argument order into a Report. Follow the presentation schema for slide image fields.',
  'Generated file downloads: after send_file_to_user succeeds, a Button may use {type: "download_artifact", params: {filename: "exact-returned-filename.docx"}} as its action. The interface resolves only ready artifacts attached to this answer and signs a fresh URL on click, including after reload. Never use sandbox/storage paths or signed URLs as download links; do not offer downloads before successful file delivery. Keep every image caption paired with its exact reuse receipt; use generated=false for originals and generated=true for edits, including PDF pages. Never infer original versus edited from reference order or image dimensions.',
  'Interactive answers: give each Form a stable unique name and each field a stable name. Wrap fields in FormControl and declare appropriate rules (required, numeric, min/max, email, etc.). Use a primary Button for validated submission. Filter, chart and table follow-up actions may pass typed JSON params (row IDs, ranges, selections); preserve booleans, numbers, arrays and explicit empty values. Submitted form state and params are saved as typed data, with visible submission status and hydration after reload. Never claim a submission succeeded before the interface accepts it.',
  'Do not use forms or buttons unless the user asked for something to fill in or a working interactive app, except generated file download buttons. Do not stack more than six blocks after the Header; pick the ones the answer needs.',
];

/** How to deliver a report next to the chat answer (see ReportBlock.tsx and report-program.ts in the front end). */
const reportRules = [
  'Presentations: when the user asks for slides, a slide deck or a presentation, emit a short Card program followed by a blank line and a separate program starting `root = Presentation({title: "Deck title", subtitle: "Short subtitle"}, [s1, s2, s3])`. The interface shows a View chip that opens the slide viewer with thumbnails and fullscreen controls. Use Presentation rather than Report for slides; no generation tool is needed to render this OpenUI program. Define every identifier within its own program. Never mix chat, report and presentation components or emit more than one artifact program in an answer.',
  'Presentation arguments are positional: preserve omitted optional slots with null when supplying later arguments. MinimalTitle(title, subtitle, helperText, author, layout, bgImageSrc) needs the author slot before layout. For a generated background, use title = MinimalTitle("Japan", "A first-trip guide", "AI generated", null, "title-bottom", "generated-image:<id>") with the exact imageSource returned by generate_image; then s1 = Slide("cover", title). Never move layout or the image source into the author slot.',
  'Slide composition: every slide is Slide("unique-id", content). Start with MinimalTitle, StandardTitle or DramaticTitle; use VisualCards for photo spotlights, KeyInfoWithTitle for comparisons, HeroMetric or InsightGrid for key figures, ChartWithContext or ChartWithMetrics for sourced chart data, and HeadlineStatement or ContentClassic for conclusions. Use four to seven slides unless a count is requested. Keep one point per slide, short titles and compact body text. Use only the Presentation Components signatures in the presentation program; obey their length and item constraints. Image sources must be actual URLs or exact generated-image:<id> receipts returned by tools, not document citation markers or invented paths. Label generated illustrations AI generated. Omit optional images when none is available, and choose a layout without required images. Keep exact source [n] markers in slide text; their clickable source chips are listed below the artifact.',
  'Reports: write a report only when the user asks for a report, a document or something to keep. The answer is then two programs: first a short Card program (a CalloutV2 or TextContent that says what the report covers, and a FollowUpBlock), then a blank line, then the report program, which starts with its own `root = Report(` line. The interface shows the report as a chip with a View button that opens it in a side panel.',
  'The report program is parsed on its own: define every identifier it uses inside it, and build it only from the Report components listed above. In it, InlineHeader, TextContent, List, Icon, Image, TagBlock and Table take the report signatures, not the chat ones. Never use Report components in the Card program.',
  'Report structure: an optional front page (MinimalFrontPage or DramaticFrontPage), then ContentPage pages of at most six blocks each. Every Page has a unique id (p1, p2, ...). Never invent image URLs: do not use StandardFrontPage, VisualCards or Image, and leave imageSrc and bgImageSrc out.',
  'Report text cannot show source chips. Keep the [n] markers where a claim comes from a source (the interface lists the sources a report marks under it), and say the source in words when it matters.',
];

/** The report program starts at its own root line (same rule as splitReportProgram in the front end). */
const REPORT_ROOT = /^[ \t]*root[ \t]*=[ \t]*(Report|Presentation)[ \t]*\(/m;

const examples = [
  `Example 1 — Source-grounded facts, chart, drivers and table
root = Card([header, stats, chart, drivers, table, follow])
header = Header("Supplier costs", "Annual EUR millions [1]")
stats = SnippetCardBlock([alpha, beta], "grid")
alpha = SnippetCardItem("alpha", IconText(Icon("cloud"), "neutral", "md", "Alpha", "Hosting [1]"), BoldText("number", "1.2M", "Annual", "text", "md"))
beta = SnippetCardItem("beta", IconText(Icon("truck"), "neutral", "md", "Beta", "Transport [1]"), BoldText("number", "0.9M", "Annual", "text", "md"))
chart = BarChart(["Alpha", "Beta"], [{category: "Cost", values: [1.2, 0.9]}], "default", "grouped", "Supplier cost", "2025 [1]", "Supplier", "EUR m", "m")
drivers = List([ListItem("Annual review", "Check notice periods before renewal [1]", Icon("calendar"))], "icon")
table = Table([Col("Supplier"), Col("Cost", "number"), Col("Action")], [["Alpha", 1.2, review], ["Beta", 0.9, review]])
review = Tag("Review", "warning")
follow = FollowUpBlock(["Show renewal terms", "Compare last year"])`,
  `Example 2 — A separate report
root = Card([lead])
lead = TextContent("The report is ready to view.")

root = Report({title: "Quarter report"}, [page])
page = Page("page", body)
body = ContentPage([heading, metrics])
heading = InlineHeader("Highlights", "Source-grounded totals [1]")
metrics = KeyMetrics("row", [{title: "Messages", text: "48,210"}, {title: "Median reply", text: "3.2 h"}])`,
  `Example 3 — A separate presentation
root = Card([lead])
lead = TextContent("The overview is ready to view.")

root = Presentation({title: "Quarter overview"}, [s1, s2])
s1 = Slide("s1", title)
title = MinimalTitle("Quarter overview", "Volume and priorities")
s2 = Slide("s2", highlights)
highlights = KeyInfoWithTitle("Highlights", [{title: "Volume", description: "48,210 messages"}, {title: "Response", description: "Median reply: 3.2 hours"}], "horizontal-grid")`,
];

Object.entries({ ...miniAppCompositionExamples, html_dashboard: `root = Card([app])
$view = {capacity: 60, notes: false}
app = MiniApp("dashboard", "Capacity explorer", "Illustrative data; updates locally.", [view])
view = HtmlView("<style>body{padding:20px;font-family:system-ui}.bar{height:16px;background:teal;border-radius:8px}</style><label>Capacity <input aria-label='Capacity' type='number' data-state='capacity'></label><p data-text='capacity'></p><div class='bar' data-progress='capacity'></div>", 240, "Capacity explorer", "view", $view)` }).forEach(([name, program]) => {
  if (name !== 'scenario') examples.push(`Example — Reusable ${name} mini-app\n${program}`);
});

/** Each example must parse without error against the library it targets, so a library upgrade fails loudly here. */
const chatParser = createParser(generationLibrary.toJSONSchema());
const reportParser = createParser(reportLibrary.toJSONSchema());
const presentationParser = createParser(presentationLibrary.toJSONSchema());
function assertValid(label, parser, program) {
  const { meta } = parser.parse(program);
  const problems = [...meta.errors.map((error) => error.message), ...meta.unresolved.map((name) => `unresolved ${name}`), ...meta.orphaned.map((name) => `unreferenced ${name}`)];
  if (problems.length > 0) throw new Error(`${label} is not valid OpenUI Lang: ${problems.join('; ')}`);
}
examples.forEach((example) => {
  const [title, ...lines] = example.split('\n');
  const body = lines.join('\n');
  const artifact = REPORT_ROOT.exec(body);
  const reportAt = artifact?.index;
  assertValid(`${title} (chat program)`, chatParser, (reportAt === undefined ? body : body.slice(0, reportAt)).trim());
  if (reportAt !== undefined) assertValid(`${title} (artifact program)`, artifact?.[1] === 'Presentation' ? presentationParser : reportParser, body.slice(reportAt).trim());
});

/**
 * The stock spec advertises Card's `sources` argument; the front end ignores it (see citationRules), so the
 * prompt must not offer it. The cut is checked, so a library upgrade that rewords the spec fails loudly.
 */
function withoutCardSources(spec) {
  const card = spec.components.Card;
  const signature = card.signature.replace(/, sources\?: \{[^}]*\}\[\]\)$/, ')');
  if (signature === card.signature) throw new Error('The stock Card spec no longer matches what withoutCardSources removes: update generate-openui-prompt.mjs.');
  return { ...spec, components: { ...spec.components, Card: { ...card, signature } } };
}

const chatPrompt = generateSystemPrompt({
  library: withoutCardSources(generationLibrary.toSpec()),
  promptOptions: {
    bindings: true,
    toolCalls: false,
    examples: examples.map((example, index) => example.replace(/^Example \d+/, `Example ${index + 1}`)),
    additionalRules: [...usageRules, ...citationRules, ...reportRules],
  },
});

/** The report components, listed after the chat ones: their signatures are what the report program may use. */
const reportSignatures = Object.values(reportLibrary.toSpec().components)
  .map((component) => component.signature)
  .join('\n');
const reportSection = [
  '## Report Components',
  '',
  'Used only in the report program (see the report rules). They replace the same-named chat components there.',
  '',
  reportSignatures,
  '',
].join('\n');

const presentationSection = [
  '## Presentation Components',
  '',
  'Used only in a separate Presentation program. These replace same-named report and chat components there.',
  '',
  ...Object.values(presentationLibrary.toSpec().components).map((component) => component.signature),
  '',
].join('\n');

const HOISTING_HEADING = '## Hoisting & Streaming';
const insertAt = chatPrompt.indexOf(HOISTING_HEADING);
if (insertAt < 0) throw new Error(`The generated prompt has no "${HOISTING_HEADING}" section to put the report components before: update generate-openui-prompt.mjs.`);
const prompt = `${chatPrompt.slice(0, insertAt)}${reportSection}\n${presentationSection}\n${chatPrompt.slice(insertAt)}`;

if (prompt.length > MAX_PROMPT_LENGTH) {
  throw new Error(`The OpenUI prompt is ${prompt.length} characters, over the ${MAX_PROMPT_LENGTH} cap: drop examples or rules in generate-openui-prompt.mjs.`);
}
if (prompt.length > TARGET_PROMPT_LENGTH) {
  process.stderr.write(`Warning: the OpenUI prompt is ${prompt.length} characters, over the ${TARGET_PROMPT_LENGTH} target.\n`);
}

/** One JSON-quoted string per prompt line, so a prompt change is a readable line diff. */
const moduleSource = [
  '// GENERATED by YellowStorm/front/scripts/generate-openui-prompt.mjs. Do not edit: run `npm run openui:prompt` in YellowStorm/front.',
  '// The OpenUI Lang output-format block appended to the prompt of agents with generative UI enabled.',
  'export const OPENUI_OUTPUT_FORMAT_PROMPT = [',
  ...prompt.split('\n').map((line) => `  ${JSON.stringify(line)},`),
  "].join('\\n');",
  '',
].join('\n');

/** The working tree may be checked out with CRLF; the content is what counts. */
const normalizeEol = (text) => text.replaceAll('\r\n', '\n');

if (checkOnly) {
  let committed = null;
  try {
    committed = readFileSync(backModule, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (committed === null || normalizeEol(committed) !== moduleSource) {
    process.stderr.write(`${backModule} is missing or out of date: run \`npm run openui:prompt\` in YellowStorm/front and commit the result.\n`);
    process.exit(1);
  }
  process.stdout.write(`OpenUI output-format module is up to date (${prompt.length} characters)\n`);
} else {
  mkdirSync(dirname(backModule), { recursive: true });
  writeFileSync(backModule, moduleSource, 'utf8');
  if (target === '-') {
    process.stdout.write(prompt);
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, prompt, 'utf8');
    process.stdout.write(`OpenUI output-format prompt written to ${target} and ${backModule} (${prompt.length} characters)\n`);
  }
}
