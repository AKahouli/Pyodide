import { checkAiUsage } from './platform-conformance';

describe('checkAiUsage', () => {
  it('accepts yellowmind-ai chatCompletion without a hardcoded model', () => {
    const source = `
      import { chatCompletion } from '@/lib/yellowmind-ai';
      await chatCompletion([{ role: 'user', content: 'hi' }]);
    `;
    expect(checkAiUsage(source)).toEqual([]);
  });

  it('rejects invented model literals in app source', () => {
    const source = `
      import { chatCompletion } from '@/lib/yellowmind-ai';
      await chatCompletion(messages, { model: 'gpt-4o-mini' });
    `;
    expect(checkAiUsage(source).join(' ')).toMatch(/Do not hardcode AI model ids/);
  });

  it('does not flag resolveDefaultAiModel implementation itself', () => {
    const source = `
      export async function resolveDefaultAiModel() {
        return 'from-env';
      }
      const params = { model: 'gpt-4o-mini', messages: [] };
    `;
    expect(checkAiUsage(source)).toEqual([]);
  });
});
