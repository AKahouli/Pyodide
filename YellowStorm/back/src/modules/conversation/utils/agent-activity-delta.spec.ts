import { compactAgentActivityUpdate } from './agent-activity-delta';

describe('compactAgentActivityUpdate', () => {
  it('sends only the appended detail and drops an unchanged summary', () => {
    const wire = compactAgentActivityUpdate(
      { summary: 'The user', detail: 'The user', status: 'completed' },
      { summary: 'The user asks', detail: 'The user asks', status: 'completed', completedAt: 't2' },
    );

    expect(wire).toEqual({
      summary: 'The user asks',
      detailDelta: ' asks',
      detailOffset: 8,
      status: 'completed',
      completedAt: 't2',
    });
    expect(wire).not.toHaveProperty('detail');
  });

  it('omits the summary once it stops changing', () => {
    const capped = `${'x'.repeat(137)}...`;
    const wire = compactAgentActivityUpdate(
      { summary: capped, detail: 'x'.repeat(200) },
      { summary: capped, detail: `${'x'.repeat(200)}yz` },
    );

    expect(wire).toEqual({ detailDelta: 'yz', detailOffset: 200 });
  });

  it('keeps a changed (even emptied) summary', () => {
    const wire = compactAgentActivityUpdate(
      { summary: 'plain', detail: 'plain' },
      { summary: '', detail: 'plain = 1' },
    );

    expect(wire).toMatchObject({ summary: '', detailDelta: ' = 1', detailOffset: 5 });
  });

  it.each([
    ['there is no previous state', undefined, { summary: 'a', detail: 'a' }],
    ['the previous detail is empty', { summary: '', detail: '' }, { summary: 'a', detail: 'a' }],
    ['the detail was rewritten', { summary: 'old text', detail: 'old text' }, { summary: 'new', detail: 'new text' }],
    ['the incoming update carries no detail', { summary: 'a', detail: 'a' }, { summary: 'b' }],
  ])('sends the full update when %s', (_label, previous, incoming) => {
    expect(compactAgentActivityUpdate(previous, incoming)).toBe(incoming);
  });

  it('reconstructs the final text from the previous detail plus deltas', () => {
    const tokens = ['The', ' user', ' wants', ' a', ' summary'];
    let detail = '';
    let client = '';
    let previous: Record<string, unknown> | undefined;
    for (const token of tokens) {
      detail += token;
      const wire = compactAgentActivityUpdate(previous, { summary: detail, detail });
      client = typeof wire.detailDelta === 'string' ? client.slice(0, wire.detailOffset as number) + wire.detailDelta : String(wire.detail);
      previous = { summary: detail, detail };
    }

    expect(client).toBe(detail);
  });
});
