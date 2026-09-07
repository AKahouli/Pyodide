import { ConversationPlaybookContextProjectorService } from './conversation-playbook-context-projector.service';

describe('ConversationPlaybookContextProjectorService', () => {
  const service = new ConversationPlaybookContextProjectorService();

  it('resolves only completed displayed answer versions', () => {
    const original = [{ type: 'text', data: { content: 'original' } }] as any;
    const corrected = [{ type: 'text', data: { content: 'corrected' } }] as any;
    const attempt = [{ type: 'text', data: { content: 'attempt' } }] as any;
    const message = {
      components: original,
      correctionWorkflow: {
        status: 'corrected',
        correctedComponents: corrected,
        attempts: [{ attemptId: 'attempt-1', status: 'accepted', components: attempt }],
      },
    } as any;

    expect(service.resolveDisplayedAnswer(message, 'original').components).toBe(original);
    expect(service.resolveDisplayedAnswer(message, 'corrected').components).toBe(corrected);
    expect(service.resolveDisplayedAnswer(message, 'attempt:attempt-1').components).toBe(attempt);
    expect(() => service.resolveDisplayedAnswer(message, 'attempt:missing')).toThrow('incomplete or stale');
  });

  it('projects a bounded allowlist and redacts secret-like text', () => {
    const answer = {
      version: 'original' as const,
      components: [{ type: 'text', data: { content: 'Use https://private.example and token=abc123' } }],
    };
    const result = service.project([
      { conversationType: 'user', content: 'Build from C:\\private\\source.csv' },
      {
        conversationType: 'ai',
        components: [
          ...answer.components,
          { type: 'toolActivity', data: { toolName: 'search', summary: 'Found the source', status: 'completed' } },
          { type: 'artifact', data: { fileName: 'report.pdf', storageKey: 'must-not-leak' } },
          { type: 'unknown', data: { payload: 'must-not-leak' } },
        ],
      },
    ] as any, answer as any);

    expect(result.context.userGoal).toBe('Build from [omitted]');
    expect(result.context.answerOutline).toBe('Use [omitted] and [omitted]');
    expect(result.context.actions).toEqual([expect.objectContaining({ name: 'search', status: 'completed' })]);
    expect(result.context.references).toEqual([{ kind: 'artifact', label: 'report.pdf' }]);
    expect(result.context.projection.omissions).toEqual(expect.objectContaining({ unknown: 1 }));
    expect(JSON.stringify(result.context)).not.toContain('must-not-leak');
  });
});
