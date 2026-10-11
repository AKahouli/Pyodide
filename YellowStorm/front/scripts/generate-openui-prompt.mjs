#!/usr/bin/env node
/**
 * Generates the OpenUI Lang system prompt for the stock `openuiLibrary` and
 * writes it to a file, so it can be pasted into an agent in the agent library
 * (agent instruction lives in the DB; nothing here seeds it).
 *
 * Usage: node scripts/generate-openui-prompt.mjs [outputPath]
 *   default outputPath: scripts/generated/openui-system-prompt.txt
 *   outputPath "-" prints to stdout.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSystemPrompt } from '@openuidev/lang-core';
import { openuiLibrary, openuiPromptOptions } from '@openuidev/react-ui/genui-lib';

const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] ?? resolve(here, 'generated', 'openui-system-prompt.txt');

/**
 * Platform citations: tools return source markers such as [1] and the front end
 * turns each one into a clickable source chip. The stock OpenUI prompt knows
 * nothing about them, so teach it where a marker may go. The marker format and
 * the component list are what the front end renders
 * (src/modules/conversation/components/openui/citations.tsx).
 */
const citationRules = [
  'Citations: when tool results give you numbered source markers such as [1], [2] or [3], keep them. Put the marker(s) right after the sentence or claim the source supports, inside the text itself (for example TextContent("Revenue grew 12% in 2024 [2]. Margins fell [1][3].")). Copy the numbers exactly as the tools returned them; never invent, renumber or reformat a marker, and never turn it into a link.',
  'Citation markers are rendered as source chips in TextContent, MarkDownRenderer, Callout, Steps, CardHeader and Table cells. Do not put them in other components (ListItem, Tag, chart labels, Buttons, form fields, Tabs or Accordion titles): they would stay as plain "[n]" text there.',
  'Do not write a sources or references list: the interface already lists the sources of an answer.',
];

const prompt = generateSystemPrompt({
  library: openuiLibrary.toSpec(),
  promptOptions: { ...openuiPromptOptions, additionalRules: [...(openuiPromptOptions.additionalRules ?? []), ...citationRules] },
});

if (target === '-') {
  process.stdout.write(prompt);
} else {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, prompt, 'utf8');
  process.stdout.write(`OpenUI system prompt written to ${target} (${prompt.length} characters)\n`);
}
