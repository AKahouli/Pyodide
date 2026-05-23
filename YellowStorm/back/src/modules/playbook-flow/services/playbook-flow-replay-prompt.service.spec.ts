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
      replayReasoningChain: true,
    },
  };
}

describe('PlaybookFlowReplayPromptService', () => {
  let service: PlaybookFlowReplayPromptService;

  beforeEach(() => {
    service = new PlaybookFlowReplayPromptService();
  });

  it('returns empty string when no reference output and no data', () => {
    const result = service.buildReplayPromptSection(makeArtifacts({
      replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: false },
    }));
    expect(result).toBe('');
  });

  it('includes reasoning chain when toggle is active', () => {
    const artifacts = makeArtifacts({
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
      outputFormatGuide: 'Return JSON with fields: summary, confidence.',
      replayConfig: { replayOutputFormat: true, replayToolTrace: false, replayReasoningChain: false },
    });

    const result = service.buildReplayPromptSection(artifacts);
    expect(result).toContain('### Output Format Guide');
    expect(result).toContain('Return JSON with fields: summary, confidence.');
  });

  it('includes all sections when all toggles are active', () => {
    const artifacts = makeArtifacts({
      outputFormatGuide: 'format guide',
      toolCalls: [{ callIndex: 1, toolName: 'search', args: {}, outputSummary: 'hits' }],
      reasoningChain: [{ id: 'r1', type: 'obs', label: 'L1', description: 'D1' }],
      replayConfig: { replayOutputFormat: true, replayToolTrace: true, replayReasoningChain: true },
    });

    const result = service.buildReplayPromptSection(artifacts);
    expect(result).toContain('### Baseline Reasoning Chain');
    expect(result).toContain('### Baseline Tool Calls');
    expect(result).toContain('### Output Format Guide');
    expect(result).not.toContain('### Reference Output');
  });

  it('skips reasoning section when chain is empty even if toggle is active', () => {
    const artifacts = makeArtifacts({
      reasoningChain: [],
      replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: true },
    });

    const result = service.buildReplayPromptSection(artifacts);
    expect(result).not.toContain('### Baseline Reasoning Chain');
  });
});
