import { PlaybookFlowReplayPromptService } from './playbook-flow-replay-prompt.service';
import type { ResolvedReplayArtifacts } from '../interfaces/playbook-flow-replay-artifact.interface';

function makeArtifacts(overrides: Partial<ResolvedReplayArtifacts> = {}): ResolvedReplayArtifacts {
  return {
    taskId: overrides.taskId ?? 'task-1',
    replayId: overrides.replayId ?? 'replay-1',
    validationVersion: overrides.validationVersion ?? 1,
    referenceOutput: overrides.referenceOutput ?? null,
    outputFormatGuide: overrides.outputFormatGuide ?? null,
    toolCalls: overrides.toolCalls ?? [],
    reasoningChain: overrides.reasoningChain ?? [],
    replayConfig: overrides.replayConfig ?? {
      replayOutputFormat: false,
      replayToolTrace: false,
      replayReasoningChain: false,
    },
  };
}

describe('PlaybookFlowReplayPromptService', () => {
  let service: PlaybookFlowReplayPromptService;

  beforeEach(() => {
    service = new PlaybookFlowReplayPromptService();
  });

  it('returns empty string when no toggles are active and no reference output', () => {
    const result = service.buildReplayPromptSection(makeArtifacts());
    expect(result).toBe('');
  });

  it('returns prompt with reference output when present', () => {
    const result = service.buildReplayPromptSection(makeArtifacts({ referenceOutput: 'Baseline answer here.' }));
    expect(result).toContain('## Validated Replay Baseline');
    expect(result).toContain('### Reference Output (verbatim, do not execute)');
    expect(result).toContain('Baseline answer here.');
    expect(result).toContain('Replay version 1');
  });

  it('includes reasoning chain when toggle is active', () => {
    const artifacts = makeArtifacts({
      referenceOutput: 'output',
      reasoningChain: [
        { id: 'r1', type: 'analysis', label: 'Risk Check', description: 'Evaluated risk factors.', confidence: 0.9 },
        { id: 'r2', type: 'decision', label: 'Verdict', description: 'Decided to proceed.', confidence: null },
      ],
      replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: true },
    });

    const result = service.buildReplayPromptSection(artifacts);
    expect(result).toContain('### Baseline Reasoning Chain');
    expect(result).toContain('[analysis] Risk Check (confidence: 90%)');
    expect(result).toContain('Evaluated risk factors.');
    expect(result).toContain('[decision] Verdict');
    expect(result).toContain('Decided to proceed.');
  });

  it('includes tool calls when toggle is active', () => {
    const artifacts = makeArtifacts({
      referenceOutput: 'output',
      toolCalls: [
        { callIndex: 1, toolName: 'perform_document_search', args: {}, outputSummary: 'hits' },
        { callIndex: 2, toolName: 'calculate', args: {}, outputSummary: '42' },
      ],
      replayConfig: { replayOutputFormat: false, replayToolTrace: true, replayReasoningChain: false },
    });

    const result = service.buildReplayPromptSection(artifacts);
    expect(result).toContain('### Baseline Tool Calls');
    expect(result).toContain('1. perform_document_search');
    expect(result).toContain('2. calculate');
  });

  it('includes output format guide when toggle is active', () => {
    const artifacts = makeArtifacts({
      referenceOutput: 'output',
      outputFormatGuide: 'Return JSON with fields: summary, confidence.',
      replayConfig: { replayOutputFormat: true, replayToolTrace: false, replayReasoningChain: false },
    });

    const result = service.buildReplayPromptSection(artifacts);
    expect(result).toContain('### Output Format Guide');
    expect(result).toContain('Return JSON with fields: summary, confidence.');
  });

  it('truncates reference output over 2000 chars', () => {
    const longOutput = 'x'.repeat(2500);
    const result = service.buildReplayPromptSection(makeArtifacts({ referenceOutput: longOutput }));
    expect(result).toContain('do not execute');
    expect(result).toContain('[...truncated]');
    expect(result).not.toContain('x'.repeat(2500));
  });

  it('includes all sections when all toggles are active', () => {
    const artifacts = makeArtifacts({
      referenceOutput: 'output',
      outputFormatGuide: 'format guide',
      toolCalls: [{ callIndex: 1, toolName: 'search', args: {}, outputSummary: 'hits' }],
      reasoningChain: [{ id: 'r1', type: 'obs', label: 'L1', description: 'D1' }],
      replayConfig: { replayOutputFormat: true, replayToolTrace: true, replayReasoningChain: true },
    });

    const result = service.buildReplayPromptSection(artifacts);
    expect(result).toContain('### Baseline Reasoning Chain');
    expect(result).toContain('### Baseline Tool Calls');
    expect(result).toContain('### Output Format Guide');
    expect(result).toContain('### Reference Output (verbatim, do not execute)');
  });

  it('skips reasoning section when chain is empty even if toggle is active', () => {
    const artifacts = makeArtifacts({
      referenceOutput: 'output',
      reasoningChain: [],
      replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: true },
    });

    const result = service.buildReplayPromptSection(artifacts);
    expect(result).not.toContain('### Baseline Reasoning Chain');
  });
});
