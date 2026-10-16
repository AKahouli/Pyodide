import { appendGenUiOutputFormat } from './gen-ui-output-format';
import { OPENUI_OUTPUT_FORMAT_PROMPT } from './openui-output-format.generated';

describe('appendGenUiOutputFormat', () => {
  it('leaves the prompt untouched when generative UI is off or unset', () => {
    expect(appendGenUiOutputFormat('Be helpful.', false)).toBe('Be helpful.');
    expect(appendGenUiOutputFormat('Be helpful.', undefined)).toBe('Be helpful.');
  });

  it('keeps the agent prompt first and adds the scoped OpenUI block after it', () => {
    const result = appendGenUiOutputFormat('Be helpful.', true);

    expect(result.startsWith('Be helpful.\n\n## Output format: OpenUI Lang (generative UI)')).toBe(true);
    expect(result.endsWith(OPENUI_OUTPUT_FORMAT_PROMPT)).toBe(true);
    expect(result).toContain('override any earlier instruction about markdown');
  });

  it('does not lead with blank lines when the agent has no prompt', () => {
    expect(appendGenUiOutputFormat('', true).startsWith('## Output format: OpenUI Lang')).toBe(true);
  });

  it('ships the generated block with the OpenUI syntax rules and the citation rules', () => {
    expect(OPENUI_OUTPUT_FORMAT_PROMPT).toContain('openui-lang');
    expect(OPENUI_OUTPUT_FORMAT_PROMPT).toContain('root = Card(');
    expect(OPENUI_OUTPUT_FORMAT_PROMPT).toContain('Citations:');
  });
});
