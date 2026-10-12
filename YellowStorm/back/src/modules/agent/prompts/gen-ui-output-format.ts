import { OPENUI_OUTPUT_FORMAT_PROMPT } from './openui-output-format.generated';

/**
 * Lead-in that scopes the block: the stock OpenUI prompt says the ENTIRE response must be OpenUI Lang, which
 * must override a pre-prompt that asks for markdown but leave role, tools, language and content rules alone.
 */
const GEN_UI_OUTPUT_FORMAT_HEADER =
  '## Output format: OpenUI Lang (generative UI)\n'
  + 'The interface renders your answer from OpenUI Lang. The rules below define the format of every answer and '
  + 'override any earlier instruction about markdown, plain text or other output formats. '
  + 'All other instructions (role, tools, sources, language, content) still apply.';

/**
 * Appends the OpenUI output-format block to a prompt already assembled from the agent's own instruction.
 * The agent's prompt stays in the database; the code only adds the format block (product rule).
 */
export function appendGenUiOutputFormat(prompt: string, genUiEnabled: boolean | undefined): string {
  if (!genUiEnabled) return prompt;
  return `${prompt}${prompt ? '\n\n' : ''}${GEN_UI_OUTPUT_FORMAT_HEADER}\n\n${OPENUI_OUTPUT_FORMAT_PROMPT}`;
}
