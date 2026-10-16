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
import { createParser, generateSystemPrompt } from '@openuidev/lang-core';
import { chatLibrary, reportLibrary, presentationLibrary } from '@openuidev/thesys';

/** The block is added to every run of an enabled agent: a hard cap keeps its token cost bounded. */
const MAX_PROMPT_LENGTH = 60000;
/** Soft target: a longer prompt still works, but it is time to drop an example or a rule. */
const TARGET_PROMPT_LENGTH = 45000;

const here = dirname(fileURLToPath(import.meta.url));
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
  'Answer with a Card program by default: `root = Card(...)` is the first line. Order: Header(title, subtitle), a one or two sentence TextContent that gives the answer itself, then the supporting blocks, then a FollowUpBlock of two or three useful next questions. Keep every text short and never repeat the same facts in two blocks.',
  'Make the answer visual: when the content fits a card, a chart, an icon list or a tag, use it instead of a paragraph or a callout. TextContent is for the one-line answer and short explanations; a table or a callout is not a substitute for stat cards and charts when the answer rests on numbers.',
  'Key figures: when the answer rests on numbers or on a few named entities (companies, contracts, products, people, periods), show them first as stat cards. SnippetCardBlock([...], "grid") of SnippetCardItem(id, IconText(Icon("lucide-name"), variant, "md", name, sublabel), BoldText("number", value, caption, "metric", "md")) puts the name on the left and the value on the right. OverviewCardBlock([...], "grid") of OverviewCardItem(id, IconText(Icon("lucide-name"), variant, "md", name, sublabel, false, "vertical"), MetricIndicatorInline(value, caption, {direction: "up", value: 12})) suits a value with a trend. Two to six cards, all built the same way. IconText variant: success for a good or growing value, danger for a bad or falling one, warning for a caution, info for a fact, neutral for a benchmark. A "metric" caption starting with + or - is colored green or red; use "text" for a plain caption.',
  'Trends and splits: when sources give you several values over time or per category, add a chart with a heading and a description: LineChart (trend, one or several series), AreaChart (one cumulative series), BarChart or HorizontalBarChart (comparison), PieChart or SegmentedBar (split, five slices at most). Put two or three charts in Tabs when they answer different questions. Only chart numbers that come from the sources: never invent, interpolate or round a series to make a chart; with no series, use stat cards or a table. For large values, scale the data and give the unit ("k", "m", "b") and an axis label instead of raw thousands or millions.',
  'Drivers, reasons, risks, pros and cons: an InlineHeader (heading, description), then List([ListItem(title, subtitle, Icon("lucide-name"))], "icon") for short points (icon tile, bold title, one-line description; every ListItem of an icon List must carry its own Icon as third argument, without it a blank dot is shown), or CompositeCardBlock([...], "grid") of CompositeCardItem(id, IconText(Icon("lucide-name"), variant, "md", title, subtitle), [TextContent(description)]) for points that need a sentence each. Icon names are lucide icon names in kebab-case (users, cloud, search, activity, dollar-sign, trending-up, trending-down, file-text, shield, calendar, clock, mail, building-2, globe, triangle-alert, circle-check, zap, target, layers, scale, wallet). Pick the icon that matches the point.',
  'Tables: use Table for a comparison of three or more entities across several attributes, and give it one coloured Tag column (status, verdict, rating, category) when such a label exists. Use Tag(text, variant) for status, category, rating or verdict cells (success, warning, danger, info, neutral): define each Tag on its own line and put its identifier in the cell, with a label of one or two words. Keep numbers and sentences as plain strings (a cell may carry [n] markers, a Tag may not). TagBlock takes at most three Tags.',
  'Card blocks (SnippetCardBlock, OverviewCardBlock, CompositeCardBlock, ContextCardBlock, VisualCardBlock) need at least two items, all with the same structure. Text, BoldText, IconText, ImageText and MetricIndicator* are building blocks used inside card items: never put them directly in the root Card.',
  'Other blocks: CalloutV2 for one caveat, decision or warning (never to explain what you did); Steps for an ordered procedure; SectionBlock or Tabs to keep a long answer short; EntityList for a label and value list. Markdown (bold, lists, links) belongs in TextContent only.',
  'Images: when the user asks for pictures, or pictures help explain destinations, products, activities or other visual subjects, use the available search or image-generation tools to obtain relevant images. Group the subjects in one image search, then make a targeted follow-up only for subjects still missing a usable image. Image, ImageBlock, ImageGallery, ImageText, ImageTextLarge, ListItem images and the bgImageSrc of VisualCardItem and ContextCardItem accept actual image URLs returned by web search, document search or image generation: copy each URL exactly and add meaningful alt text. A web-page URL is not an image URL. Never invent image or link URLs; when no tool supplies an image, use IconText cards and briefly explain the missing image if the user requested one.',
  'Photo layouts: for destination recommendations, travel guides and sightseeing activities, obtain relevant photographs before composing the answer even when the user did not explicitly ask for pictures. If the configured search tool exposes an image-results option, enable it and request search results rather than only a synthesized text answer; otherwise search for direct image URLs. Reuse relevant image URLs already returned in the conversation and avoid repeated searches once enough usable images are available. Present two to six destinations, products or activities as VisualCardBlock([...], "grid") of VisualCardItem(BoldText("text", name, detail), id, imageUrl, Tag(label, variant), alt), like a visual travel guide. Use "carousel" for a longer browsable collection. Use ImageGallery for a collection of pictures without card details, Image for one original figure, and ImageText or ImageTextLarge inside card items when a thumbnail should accompany descriptive text. Put related activity collections in Tabs when useful. Choose the stock OpenUI image components rather than Markdown image syntax or bare image links. Preserve source citations in accompanying TextContent or supported card text; generated illustrations must be identified as generated and must not be described as documentary photographs.',
  'Image editing and reuse: call generate_image for original illustrations, edits, or importing images for documents. sourceImage edits and reuseImage imports without generation; either accepts a saved generated-image:<id>, an exact public HTTPS image URL from web search, or an exact uploaded/workspace image or PDF filename. For PDFs sourcePage selects the page (1-based). Its exact imageSource, generated-image:<id>, is valid in chat image components and Presentation slide image fields. Reuse the receipt exactly and never invent references. Label AI generated only when the receipt generated flag is true; imported originals are not AI generated. Reuse existing receipts for slides and use sandboxPath in the code interpreter for DOCX/editable PPTX, including after reload.',
  'Document images are an exception to the URL rule: when document search returns a cited image or PDF figure, use its exact citation marker as the image source, for example figure = Image("Original bar chart from test_image.pdf", "[1]"). The interface resolves [1] using that answer’s attached document citation and renders the extracted image or cited PDF region/page. Use Image for one figure and ImageGallery(["First figure", "Second figure"], ["[1]", "[2]"]) for several; the same references work in image cards, list images and image-backed options. When asked to show a document image, display the original figure this way instead of recreating it as a chart. Keep its [n] citation in the caption or accompanying TextContent, and give meaningful alt text. Never invent a reference, use a text-only passage as an image, put a document storage path in src, or use a web-page citation as an image source.',
  'Image argument order depends on the active library: CHAT uses Image(alt, src), while REPORT uses Image(src, alt). In a Report program write Image("generated-image:RETURNED_ID", "Exact caption") or Image("[1]", "Original PDF figure"). Never copy the chat argument order into a Report. Follow the presentation schema for slide image fields.',
  'Generated file downloads: after send_file_to_user succeeds, a Button may use {type: "download_artifact", params: {filename: "exact-returned-filename.docx"}} as its action. The interface resolves only ready artifacts attached to this answer and signs a fresh URL on click, including after reload. Never use sandbox/storage paths or signed URLs as download links; do not offer downloads before successful file delivery. Keep every image caption paired with its exact reuse receipt; use generated=false for originals and generated=true for edits, including PDF pages. Never infer original versus edited from reference order or image dimensions.',
  'Interactive answers: give each Form a stable unique name and each field a stable name. Wrap fields in FormControl and declare appropriate rules (required, numeric, min/max, email, etc.). Use a primary Button for validated submission. Filter, chart and table follow-up actions may pass typed JSON params (row IDs, ranges, selections); preserve booleans, numbers, arrays and explicit empty values. Submitted form state and params are saved as typed data, with visible submission status and hydration after reload. Never claim a submission succeeded before the interface accepts it.',
  'Do not use forms or buttons unless the user asked for something to fill in, except generated file download buttons. Do not stack more than six blocks after the Header; pick the ones the answer needs.',
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
  `Example 1 — Comparison: stat cards, a chart, an icon list of drivers and a table with tags
root = Card([header, lead, stats, trend, driversHeading, drivers, compare, caveat, follow])
header = Header("Vendor contracts at a glance", "Annual value and renewal terms, 2023 to 2025")
lead = TextContent("Orion is the costliest contract and the only one indexed on prices; two of the three renew in 2026 [1].")
stats = SnippetCardBlock([orion, delta, vega], "grid")
orion = SnippetCardItem("orion", orionName, orionValue)
orionName = IconText(Icon("truck"), "warning", "md", "Orion Logistics", "Transport [1]")
orionValue = BoldText("number", "EUR 1.2M", "+6% vs 2024", "metric", "md")
delta = SnippetCardItem("delta", deltaName, deltaValue)
deltaName = IconText(Icon("cloud"), "success", "md", "Delta Cloud", "Hosting [2]")
deltaValue = BoldText("number", "EUR 0.9M", "-2% vs 2024", "metric", "md")
vega = SnippetCardItem("vega", vegaName, vegaValue)
vegaName = IconText(Icon("printer"), "neutral", "md", "Vega Print", "Printing")
vegaValue = BoldText("number", "EUR 0.3M", "Flat", "text", "md")
trend = LineChart(["2023", "2024", "2025"], [orionSeries, deltaSeries], "default", "natural", "Annual cost by supplier", "EUR millions per year", "Year", "EUR m", "m")
orionSeries = {category: "Orion", values: [1.0, 1.13, 1.2]}
deltaSeries = {category: "Delta Cloud", values: [0.8, 0.92, 0.9]}
driversHeading = InlineHeader("Key drivers", "What moved the cost")
drivers = List([indexation, discount, volume], "icon")
indexation = ListItem("Price indexation", "Orion follows the transport index, capped at 6% a year [1]", Icon("trending-up"))
discount = ListItem("Volume discount", "Delta Cloud applies a discount tier above 500 TB [2]", Icon("trending-down"))
volume = ListItem("Stable volumes", "Vega Print has been flat since 2023", Icon("scale"))
compare = Table([Col("Supplier"), Col("Renewal"), Col("Notice (days)", "number"), Col("Action")], [["Orion Logistics", "31/12/2026 [1]", 90, renegotiate], ["Delta Cloud", "30/06/2026 [2]", 60, renew], ["Vega Print", "Open-ended", 30, review]])
renegotiate = Tag("Renegotiate", "warning")
renew = Tag("Renew", "success")
review = Tag("Review", "neutral")
caveat = CalloutV2("info", "Check the notice dates", "A missed notice window renews the contract for 12 months [1].")
follow = FollowUpBlock(["Show the indexation clause", "Compare 2025 with the budget"])`,
  `Example 2 — Key facts with trend cards, a split and next steps
root = Card([header, summary, facts, split, steps, follow])
header = Header("Contract renewal", "ACME Corp, service agreement")
summary = TextContent("The agreement renews automatically on 31/12/2025 unless notice is given 90 days before [1].")
facts = OverviewCardBlock([term, notice, price], "grid")
term = OverviewCardItem("term", termName, termValue)
termName = IconText(Icon("calendar"), "info", "md", "Renewal date", "Automatic, 12 months [1]", false, "vertical")
termValue = MetricIndicatorInline("31/12/2025", "Same price unless indexed")
notice = OverviewCardItem("notice", noticeName, noticeValue)
noticeName = IconText(Icon("clock"), "warning", "md", "Notice period", "By registered letter", false, "vertical")
noticeValue = MetricIndicatorInline("90 days", "Before the renewal date")
price = OverviewCardItem("price", priceName, priceValue)
priceName = IconText(Icon("wallet"), "success", "md", "Annual fee", "Indexed on the services index [2]", false, "vertical")
priceValue = MetricIndicatorInline("EUR 84k", "Per year", {direction: "up", value: 3})
split = PieChart([{category: "Licences", value: 52}, {category: "Support", value: 24}, {category: "Hosting", value: 8}], "donut", "Fee split", "EUR thousands per year", "k")
steps = Steps([s1, s2], "What to do next")
s1 = StepsItem("Decide by 2 October 2025", "Check usage and the price index before the notice window closes [2].")
s2 = StepsItem("Send the notice", "Use registered mail and keep the receipt.")
follow = FollowUpBlock(["Show the indexation clause", "Draft the notice letter"])`,
  `Example 4 — A report: a short Card program, a blank line, then the report program
root = Card([ready, follow])
ready = CalloutV2("success", "Report ready", "The Q3 mail report covers volume and response times. Open it with View. Volume is up 12% [1].")
follow = FollowUpBlock(["Add a page on escalations"])

root = Report({title: "Q3 mail report", subtitle: "Volume and response times"}, [p1, p2])
p1 = Page("p1", cover)
cover = MinimalFrontPage("Q3 mail report", coverText, "Volume and response times")
coverText = TextContent("Prepared from the mail model, July to September.")
p2 = Page("p2", body)
body = ContentPage([head, metrics, prose, table])
head = InlineHeader("Highlights", "Quarter to date")
metrics = KeyMetrics("row", [{title: "Messages", text: "48,210"}, {title: "Median reply", text: "3.2 h"}])
prose = TextContent("Message volume grew 12% on the previous quarter [1].")
table = Table([Column("Region", "text"), Column("Messages", "number")], [["EMEA", 21100], ["Americas", 27110]])`,
  `Example 4 — A separate four-slide presentation
root = Card([lead])
lead = TextContent("The four-slide overview is ready to view.")

root = Presentation({title: "Quarter overview", subtitle: "Volume and priorities"}, [s1, s2, s3, s4])
s1 = Slide("s1", title)
title = MinimalTitle("Quarter overview", "Volume and priorities")
s2 = Slide("s2", highlights)
highlights = KeyInfoWithTitle("Highlights", [{title: "Volume", description: "48,210 messages"}, {title: "Response", description: "Median reply: 3.2 hours"}], "horizontal-grid")
s3 = Slide("s3", comparison)
comparison = ChartWithContext("Messages by region", chart)
chart = BarChartV2({data: {labels: ["EMEA", "Americas"], series: [{category: "Messages", values: [21100, 27110]}]}}, "Region", "Messages")
s4 = Slide("s4", takeaway)
takeaway = HeadlineStatement("Next step", "Prioritize the busiest regions", "title-top")`,
];

/** Each example must parse without error against the library it targets, so a library upgrade fails loudly here. */
const chatParser = createParser(chatLibrary.toJSONSchema());
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
  library: withoutCardSources(chatLibrary.toSpec()),
  promptOptions: {
    examples: examples.map((example, index) => example.replace(/^Example \d+/, `Example ${index + 1}`)),
    additionalRules: [...usageRules, ...citationRules, ...reportRules],
  },
});

/** The report components, listed after the chat ones: their signatures are what the report program may use. */
const reportSignatures = Object.values(reportLibrary.toSpec().components)
  .map((component) => (component.description ? `${component.signature} — ${component.description}` : component.signature))
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
