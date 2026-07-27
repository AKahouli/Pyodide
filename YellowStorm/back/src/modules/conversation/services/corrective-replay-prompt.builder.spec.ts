import { CorrectiveReplayPromptBuilder, MAX_REPLAY_FINDINGS, MAX_REPLAY_FINDING_CHARACTERS } from './corrective-replay-prompt.builder';

describe('CorrectiveReplayPromptBuilder', () => {
  it('keeps the original query and includes only unresolved bounded findings', () => {
    const findings = Array.from({ length: MAX_REPLAY_FINDINGS + 2 }, (_, index) => ({
      claim: `claim-${index}${'x'.repeat(MAX_REPLAY_FINDING_CHARACTERS)}`,
      status: index === 0 ? 'supported' as const : 'unsupported' as const,
      importance: 'major' as const,
      explanation: 'e'.repeat(MAX_REPLAY_FINDING_CHARACTERS + 10),
    }));
    const result = new CorrectiveReplayPromptBuilder().build({
      originalQuestion: 'Original question?',
      originalAnswer: 'Previous answer',
      evaluation: { status: 'completed', findings },
      attemptNumber: 2,
    });

    expect(result.userQuery).toBe('Original question?');
    expect(result.correctionContext.findings).toHaveLength(MAX_REPLAY_FINDINGS);
    expect(result.correctionContext.findings).not.toContainEqual(expect.objectContaining({ status: 'supported' }));
    expect(result.correctionContext.findings[0].explanation).toHaveLength(MAX_REPLAY_FINDING_CHARACTERS);
    expect(result.correctionContext.instructions).toContain('normal agent workflow');
  });
});
