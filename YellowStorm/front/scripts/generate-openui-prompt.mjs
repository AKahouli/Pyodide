#!/usr/bin/env node
/**
 * Generates the OpenUI Lang system prompt for the thesys `chatLibrary` (the Conversation renderer, see
 * src/modules/conversation/components/openui) plus its report components, and writes it to a file, so it
 * can be pasted into an agent in the agent library (agent instruction lives in the DB; nothing here seeds it).
 *
 * Usage: node scripts/generate-openui-prompt.mjs [outputPath]
 *   default outputPath: scripts/generated/openui-system-prompt.txt
 *   outputPath "-" prints to stdout.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createParser, generateSystemPrompt } from '@openuidev/lang-core';
import { chatLibrary, reportLibrary } from '@openuidev/thesys';

/** Hard cap of the agent instruction field; the output is kept well under it to leave room for edits. */
const MAX_PROMPT_LENGTH = 50000;
/** Soft target: a longer prompt still works, but it is time to drop an example or a rule. */
const TARGET_PROMPT_LENGTH = 45000;

const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] ?? resolve(here, 'generated', 'openui-system-prompt.txt');

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

/** How to answer in the chat program. */
const usageRules = [
  'Answer with a Card program by default: `root = Card(...)` is the first line. Lead with the answer itself (Header and TextContent), then the supporting blocks, and end with a FollowUpBlock of two or three useful next questions. Keep every text short.',
  'Pick the block that fits the content: CompositeCardBlock, OverviewCardBlock or SnippetCardBlock for entities and key facts, Table for comparisons, a chart for a trend or a split, Steps for a procedure, CalloutV2 for a caveat or a decision, SectionBlock or Tabs to keep a long answer short. Markdown (bold, lists, links) belongs in TextContent only.',
  'Never invent image or link URLs, and do not use forms or buttons unless the user asked for something to fill in.',
];

/** How to deliver a report next to the chat answer (see ReportBlock.tsx and report-program.ts in the front end). */
const reportRules = [
  'Reports: write a report only when the user asks for a report, a document or something to keep. The answer is then two programs: first a short Card program (a CalloutV2 or TextContent that says what the report covers, and a FollowUpBlock), then a blank line, then the report program, which starts with its own `root = Report(` line. The interface shows the report as a chip with a View button that opens it in a side panel.',
  'The report program is parsed on its own: define every identifier it uses inside it, and build it only from the Report components listed above. In it, InlineHeader, TextContent, List, Icon, Image, TagBlock and Table take the report signatures, not the chat ones. Never use Report components in the Card program.',
  'Report structure: an optional front page (MinimalFrontPage or DramaticFrontPage), then ContentPage pages of at most six blocks each. Every Page has a unique id (p1, p2, ...). Never invent image URLs: do not use StandardFrontPage, VisualCards or Image, and leave imageSrc and bgImageSrc out.',
  'Report text cannot show source chips. Keep the [n] markers where a claim comes from a source (the interface lists the sources a report marks under it), and say the source in words when it matters.',
];

/** The report program starts at its own root line (same rule as splitReportProgram in the front end). */
const REPORT_ROOT = /^[ \t]*root[ \t]*=[ \t]*Report[ \t]*\(/m;

const examples = [
  `Example 1 — Informational response with card blocks, steps and follow-ups
root = Card([header, summary, facts, steps, follow])
header = Header("Contract renewal", "ACME Corp, service agreement")
summary = TextContent("The agreement renews automatically on 31/12/2025 unless notice is given 90 days before [1].")
facts = CompositeCardBlock([term, notice])
term = CompositeCardItem("term", termHead, [termBody])
termHead = IconText(calendarIcon, "info", "m", "Renewal date", "31/12/2025 [1]")
termBody = Text("text", "Automatic, 12 months", "Same price unless indexed [2]")
notice = CompositeCardItem("notice", noticeHead, [noticeBody])
noticeHead = IconText(clockIcon, "warning", "m", "Notice period", "90 days")
noticeBody = Text("text", "Written notice required", "By registered letter")
calendarIcon = Icon("calendar")
clockIcon = Icon("clock")
steps = Steps([s1, s2], "What to do next")
s1 = StepsItem("Decide by 2 October 2025", "Check usage and the price index before the notice window closes [2].")
s2 = StepsItem("Send the notice", "Use registered mail and keep the receipt.")
follow = FollowUpBlock(["Show the indexation clause", "Draft the notice letter"])`,
  `Example 2 — Data response with a chart and a table
root = Card([title, tabs, follow])
title = Header("Revenue by region", "FY2024, millions EUR")
tabs = Tabs([overviewTab, tableTab])
overviewTab = TabItem("overview", "Overview", [chart, note])
chart = BarChart(["EMEA", "Americas", "APAC"], [s2023, s2024], "default", "grouped", "Revenue", "Year over year", "Region", "EUR m")
s2023 = {category: "2023", values: [120, 340, 210]}
s2024 = {category: "2024", values: [135, 360, 250]}
note = CalloutV2("info", "Growth leader", "APAC grew 19% [1].")
tableTab = TabItem("table", "Table", [table])
table = Table([Col("Region"), Col("2024", "number"), Col("Change", "number")], [["EMEA", 135, "+12%"], ["Americas", 360, "+6%"], ["APAC", 250, "+19%"]])
follow = FollowUpBlock(["Break APAC down by country"])`,
  `Example 3 — A report: a short Card program, a blank line, then the report program
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
];

/** Each example must parse without error against the library it targets, so a library upgrade fails loudly here. */
const chatParser = createParser(chatLibrary.toJSONSchema());
const reportParser = createParser(reportLibrary.toJSONSchema());
function assertValid(label, parser, program) {
  const { meta } = parser.parse(program);
  const problems = [...meta.errors.map((error) => error.message), ...meta.unresolved.map((name) => `unresolved ${name}`), ...meta.orphaned.map((name) => `unreferenced ${name}`)];
  if (problems.length > 0) throw new Error(`${label} is not valid OpenUI Lang: ${problems.join('; ')}`);
}
examples.forEach((example) => {
  const [title, ...lines] = example.split('\n');
  const body = lines.join('\n');
  const reportAt = REPORT_ROOT.exec(body)?.index;
  assertValid(`${title} (chat program)`, chatParser, (reportAt === undefined ? body : body.slice(0, reportAt)).trim());
  if (reportAt !== undefined) assertValid(`${title} (report program)`, reportParser, body.slice(reportAt).trim());
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

const HOISTING_HEADING = '## Hoisting & Streaming';
const insertAt = chatPrompt.indexOf(HOISTING_HEADING);
if (insertAt < 0) throw new Error(`The generated prompt has no "${HOISTING_HEADING}" section to put the report components before: update generate-openui-prompt.mjs.`);
const prompt = `${chatPrompt.slice(0, insertAt)}${reportSection}\n${chatPrompt.slice(insertAt)}`;

if (prompt.length > MAX_PROMPT_LENGTH) {
  throw new Error(`The OpenUI prompt is ${prompt.length} characters, over the ${MAX_PROMPT_LENGTH} limit of the agent instruction: drop examples or rules in generate-openui-prompt.mjs.`);
}
if (prompt.length > TARGET_PROMPT_LENGTH) {
  process.stderr.write(`Warning: the OpenUI prompt is ${prompt.length} characters, over the ${TARGET_PROMPT_LENGTH} target.\n`);
}

if (target === '-') {
  process.stdout.write(prompt);
} else {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, prompt, 'utf8');
  process.stdout.write(`OpenUI system prompt written to ${target} (${prompt.length} characters)\n`);
}
