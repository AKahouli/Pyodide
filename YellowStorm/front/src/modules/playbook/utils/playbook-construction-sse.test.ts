import { describe, expect, it } from 'vitest';
import { parsePlaybookConstructionSseBlock } from './playbook-construction-sse';

describe('parsePlaybookConstructionSseBlock', () => {
  it('parses ordered SSE data independently of event and id fields', () => {
    expect(parsePlaybookConstructionSseBlock([
      'id: 8',
      'event: completed',
      'data: {"type":"completed","constructionId":"c1","playbookId":"p1","sequence":8,"createdAt":"2026-07-18T00:00:00.000Z","model":"test","finalSuggestionCount":1}',
    ].join('\n'))).toMatchObject({ type: 'completed', sequence: 8 });
  });

  it('rejects events without a resumable positive sequence', () => {
    expect(() => parsePlaybookConstructionSseBlock('data: {"type":"completed"}')).toThrow('invalid sequence');
  });
});
