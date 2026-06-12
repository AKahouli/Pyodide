import { PlaybookFlowReplayPromptService } from './playbook-flow-replay-prompt.service';
import type { ResolvedReplayArtifacts } from '../interfaces/playbook-flow-replay-artifact.interface';
import { FlowReplayOutputContractType } from '../schemas/playbook-flow-validated-replay.schema';

function makeArtifacts(overrides: Partial<ResolvedReplayArtifacts> = {}): ResolvedReplayArtifacts {
  return {
    taskId: overrides.taskId ?? 'task-1',
    replayId: overrides.replayId ?? 'replay-1',
    referenceExecutionId: overrides.referenceExecutionId ?? 'reference-exec-1',
    validationVersion: overrides.validationVersion ?? 1,
    mode: overrides.mode ?? 'replay_strict',
    isStale: overrides.isStale ?? false,
    staleReasons: overrides.staleReasons ?? [],
    referenceOutput: overrides.referenceOutput ?? null,
    outputFormatGuide: overrides.outputFormatGuide ?? null,
    intentKey: overrides.intentKey ?? null,
    intentLabel: overrides.intentLabel ?? null,
    reasoningOutline: overrides.reasoningOutline ?? [],
    stableReasoningRules: overrides.stableReasoningRules ?? [],
    contextVariableSchema: overrides.contextVariableSchema ?? [],
    toolTraceTemplate: overrides.toolTraceTemplate ?? [],
    driftPolicy: overrides.driftPolicy ?? null,
    toolCalls: overrides.toolCalls ?? [],
    reasoningChain: overrides.reasoningChain ?? [],
    fingerprints: overrides.fingerprints ?? null,
    behaviorBaseline: overrides.behaviorBaseline ?? null,
    toolPolicy: overrides.toolPolicy ?? null,
    outputContract: overrides.outputContract ?? null,
    replayConfig: overrides.replayConfig ?? {
      replayOutputFormat: false,
      replayToolTrace: false,
      replayReasoningChain: true,
    },
    semanticChecklist: overrides.semanticChecklist ?? [],
    hitlMemorySnapshots: overrides.hitlMemorySnapshots ?? [],
  };
}

describe('PlaybookFlowReplayPromptService', () => {
  let service: PlaybookFlowReplayPromptService;

  beforeEach(() => {
    service = new PlaybookFlowReplayPromptService();
  });

  it('returns empty string when no reference output and no data', () => {
    const result = service.buildReplayPromptSection({ artifacts: makeArtifacts({
      replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: false },
    }) });
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

    const result = service.buildReplayPromptSection({ artifacts });
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

    const result = service.buildReplayPromptSection({ artifacts });
    expect(result).toContain('### Baseline Tool Calls');
    expect(result).toContain('1. perform_document_search');
    expect(result).toContain('2. calculate');
  });

  it('includes output format guide when toggle is active', () => {
    const artifacts = makeArtifacts({
      outputFormatGuide: 'Return JSON with fields: summary, confidence.',
      replayConfig: { replayOutputFormat: true, replayToolTrace: false, replayReasoningChain: false },
    });

    const result = service.buildReplayPromptSection({ artifacts });
    expect(result).toContain('### Output Format Guide');
    expect(result).toContain('Return JSON with fields: summary, confidence.');
  });

  it('prefers explicit format guide over freeform output contract text', () => {
    const artifacts = makeArtifacts({
      outputFormatGuide: 'Use sections Summary and Sources.',
      outputContract: {
        type: FlowReplayOutputContractType.FREEFORM,
        requiredSections: [],
        forbiddenSections: [],
        jsonSchema: null,
        citationPolicy: 'optional',
      },
      replayConfig: { replayOutputFormat: true, replayToolTrace: false, replayReasoningChain: false },
    });

    const result = service.buildReplayPromptSection({ artifacts });

    expect(result).toContain('### Output Format Guide');
    expect(result).not.toContain('### Output Contract');
  });

  it('includes all sections when all toggles are active', () => {
    const artifacts = makeArtifacts({
      outputFormatGuide: 'format guide',
      toolCalls: [{ callIndex: 1, toolName: 'search', args: {}, outputSummary: 'hits' }],
      reasoningChain: [{ id: 'r1', type: 'obs', label: 'L1', description: 'D1' }],
      replayConfig: { replayOutputFormat: true, replayToolTrace: true, replayReasoningChain: true },
    });

    const result = service.buildReplayPromptSection({ artifacts });
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

    const result = service.buildReplayPromptSection({ artifacts });
    expect(result).not.toContain('### Baseline Reasoning Chain');
  });

  it('prefers structured baseline sections and includes mode', () => {
    const artifacts = makeArtifacts({
      mode: 'replay_flex',
      behaviorBaseline: {
        decisionInvariants: ['Verify evidence before answer.'],
        qualityChecks: ['Include validated sources.'],
        knownFailureModes: ['Avoid unsupported claims.'],
        behaviorSummary: 'Verify evidence before answer.',
      },
      toolPolicy: {
        requiredTools: ['search'],
        forbiddenTools: ['calculator'],
        sequencingRules: ['Call search before summarizer.'],
        requireSameOrder: false,
      },
      outputContract: {
        type: FlowReplayOutputContractType.MARKDOWN_SECTIONS,
        requiredSections: ['Summary', 'Sources'],
        forbiddenSections: [],
        jsonSchema: null,
        citationPolicy: 'required',
      },
    });

    const result = service.buildReplayPromptSection({ artifacts, mode: 'replay_flex' });

    expect(result).toContain('Replay mode: replay_flex.');
    expect(result).toContain('### Decision Invariants');
    expect(result).toContain('Verify evidence before answer.');
    expect(result).toContain('### Validated Tool Policy');
    expect(result).toContain('Do not use tool: calculator');
    expect(result).toContain('### Output Contract');
    expect(result).toContain('Include sections: Summary, Sources');
    expect(result).toContain('### Quality Checks');
    expect(result).toContain('### Known Failure Modes');
    expect(result).not.toContain('baseline output');
  });

  it('includes the raw reasoning chain when replay reasoning is enabled even with structured behavior guidance', () => {
    const artifacts = makeArtifacts({
      behaviorBaseline: {
        decisionInvariants: ['Verify evidence before answer.'],
        qualityChecks: [],
        knownFailureModes: [],
        behaviorSummary: 'Verify evidence before answer.',
      },
      reasoningChain: [
        { id: 'reason-1', type: 'analysis', label: 'Risk Check', description: 'Validated the replay path.' },
      ],
      replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: true },
    });

    const result = service.buildReplayPromptSection({ artifacts });

    expect(result).toContain('### Decision Invariants');
    expect(result).toContain('### Baseline Reasoning Chain');
    expect(result).toContain('[analysis] Risk Check');
    expect(result).toContain('Validated the replay path.');
  });

  it('requires validated tool order only for strict replay mode', () => {
    const artifacts = makeArtifacts({
      toolPolicy: {
        requiredTools: ['search'],
        forbiddenTools: [],
        sequencingRules: ['Call search before summarizer.'],
        requireSameOrder: true,
      },
    });

    const strictResult = service.buildReplayPromptSection({ artifacts, mode: 'replay_strict' });
    const flexResult = service.buildReplayPromptSection({ artifacts, mode: 'replay_flex' });

    expect(strictResult).toContain('Use tool: search');
    expect(strictResult).toContain('Call search before summarizer.');
    expect(strictResult).toContain('Preserve the validated tool order.');
    expect(flexResult).toContain('Use tool: search');
    expect(flexResult).not.toContain('Preserve the validated tool order.');
  });

  it('returns empty prompt when eligibility says replay is not applied', () => {
    const artifacts = makeArtifacts({
      behaviorBaseline: {
        decisionInvariants: ['Verify evidence before answer.'],
        qualityChecks: [],
        knownFailureModes: [],
        behaviorSummary: '',
      },
    });

    const result = service.buildReplayPromptSection({
      artifacts,
      eligibility: {
        applied: false,
        confidenceScore: 20,
        confidenceFactors: {},
        invalidationReasons: ['node_snapshot_mismatch'],
        appliedSections: [],
        skippedSections: ['decision_invariants'],
      },
    });

    expect(result).toBe('');
  });

  it('includes replay flex planning guidance when provided', () => {
    const artifacts = makeArtifacts({
      intentLabel: 'Summarize earnings change',
      stableReasoningRules: ['Keep the validated comparison logic.'],
    });

    const result = service.buildReplayPromptSection({
      artifacts,
      mode: 'replay_flex',
      planning: {
        replayId: 'replay-1',
        validationVersion: 2,
        intentKey: 'earnings_summary',
        intentLabel: 'Summarize earnings change',
        contextMapping: [
          {
            variableKey: 'ticker',
            key: 'ticker',
            label: 'Ticker',
            source: 'input_context',
            valueType: 'string',
            required: true,
            baselineValue: 'AAPL',
            currentValue: 'MSFT',
            confidence: 1,
            reason: 'matched_input_context',
            value: 'MSFT',
            matched: true,
          },
        ],
        executionPlan: {
          taskId: 'task-1',
          replayId: 'replay-1',
          validationVersion: 2,
          intentKey: 'earnings_summary',
          intentLabel: 'Summarize earnings change',
          matchedContextCount: 1,
          missingRequiredContextCount: 0,
          requiredStageLabels: ['Extract data', 'Summarize delta'],
          requiredOutputChecks: ['Include section: Summary'],
          plannedToolSteps: [
            {
              stepIndex: 1,
              toolName: 'search_financials',
              purpose: 'load current earnings',
              required: true,
              argumentShape: { ticker: 'string', dateRange: 'string' },
              argumentShapeKeys: ['ticker', 'dateRange'],
              expectedArgs: { ticker: 'MSFT', dateRange: 'Q1 2026' },
              sourceCallIndex: 1,
            },
          ],
          semanticChecklist: [],
        },
      },
    });

    expect(result).toContain('### Replay Plan');
    expect(result).toContain('Preserve intent: Summarize earnings change');
    expect(result).toContain('Preserve validated tool purposes and argument shapes using current substituted context values.');
    expect(result).toContain('Context variable Ticker: AAPL -> MSFT');
    expect(result).toContain('Required stage: Extract data');
    expect(result).toContain('Tool step 1: search_financials with arguments {"ticker":"MSFT","dateRange":"Q1 2026"}');
    expect(result).toContain('Keep the validated comparison logic.');
  });

  it('includes only reusable HITL memory snapshots', () => {
    const artifacts = makeArtifacts({
      hitlMemorySnapshots: [
        {
          interruptId: 'clarify-1',
          nodeId: 'task-1',
          iteration: 0,
          type: 'clarification',
          blockerKind: null,
          reasonCode: 'missing_document',
          prompt: 'Which contract?',
          responseAction: 'reply',
          responseMessage: 'Use the signed May contract.',
          responseScope: 'downstream_run',
          downstreamNodeIds: [],
          reusableInReplay: true,
          contextFingerprint: 'hitl-a',
        },
        {
          interruptId: 'approval-1',
          nodeId: 'task-1',
          iteration: 0,
          type: 'approval_request',
          blockerKind: null,
          reasonCode: 'external_send',
          prompt: 'Send email?',
          responseAction: 'approve',
          responseMessage: 'Approved once.',
          responseScope: 'step_only',
          downstreamNodeIds: [],
          reusableInReplay: false,
          contextFingerprint: 'hitl-b',
        },
      ],
    });

    const result = service.buildReplayPromptSection({ artifacts });

    expect(result).toContain('### Reusable HITL Memory');
    expect(result).toContain('clarification (missing_document, scope downstream_run): Use the signed May contract.');
    expect(result).not.toContain('Approved once.');
  });
});
