import { PlaybookFlowReplayBaselineService } from './playbook-flow-replay-baseline.service';
import { PlaybookFlowReplayHashService } from './playbook-flow-replay-hash.service';
import { FlowReplayOutputContractType } from '../schemas/playbook-flow-validated-replay.schema';
import { PlaybookFlowOutputContractService } from './playbook-flow-output-contract.service';

describe('PlaybookFlowReplayBaselineService', () => {
  let service: PlaybookFlowReplayBaselineService;

  beforeEach(() => {
    service = new PlaybookFlowReplayBaselineService(
      new PlaybookFlowReplayHashService(),
      new PlaybookFlowOutputContractService(),
    );
  });

  it('builds deterministic replay baseline metadata', () => {
    const result = service.buildValidatedReplayBaseline({
      taskId: 'task-1',
      taskTitle: 'Review customer SLA',
      taskDescription: 'Review the latest SLA change request.',
      referenceExecutionId: 'exec-1',
      referenceExecutionNumber: 7,
      mode: 'strict_replay',
      inputContext: { query: 'hello' },
      flowSnapshot: { nodes: [{ id: 'task-1' }] },
      nodeSnapshot: {
        id: 'task-1',
        modelId: 'gpt-4o-mini',
        metadata: { agent_model: 'gpt-4o-mini', agent_tools: ['search'] },
      },
      taskResult: {
        output: { summary: 'ok', confidence: 0.9 },
        toolTrace: [
          { callIndex: 1, toolName: 'search', args: {}, status: 'completed' },
          { callIndex: 2, toolName: 'calculator', args: {}, status: 'completed' },
        ],
        reasoningChain: [
          { id: 'r1', type: 'analysis', label: 'Check facts', description: 'Verify supporting facts.' },
        ],
        judgeResult: {
          missingFacts: ['include SLA'],
          unsupportedClaims: ['invented discount'],
        },
      },
      preserveOutputFormat: true,
    });

    expect(result.mode).toBe('replay_strict');
    expect(result.fingerprints.inputContextHash).toBeTruthy();
    expect(result.behaviorBaseline.decisionInvariants).toContain('Check facts: Verify supporting facts.');
    expect(result.behaviorBaseline.qualityChecks).toContain('Cover required fact: include SLA');
    expect(result.behaviorBaseline.knownFailureModes).toContain('Avoid unsupported claim: invented discount');
    expect(result.toolPolicy.requiredTools).toEqual(['search', 'calculator']);
    expect(result.toolPolicy.requireSameOrder).toBe(true);
    expect(result.intentKey).toBe('review-customer-sla');
    expect(result.intentLabel).toBe('Review customer SLA');
    expect(result.reasoningOutline).toEqual([
      expect.objectContaining({ stageKey: 'analysis-check-facts', label: 'Check facts', description: 'Verify supporting facts.' }),
    ]);
    expect(result.stableReasoningRules).toContain('Preserve check facts.');
    expect(result.contextVariableSchema).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'taskTitle', source: 'task', valueType: 'string' }),
      expect.objectContaining({ key: 'query', source: 'input_context', valueType: 'string' }),
    ]));
    expect(result.toolTraceTemplate).toEqual([
      expect.objectContaining({ stepIndex: 1, toolName: 'search', argumentShape: {} }),
      expect.objectContaining({ stepIndex: 2, toolName: 'calculator', argumentShape: {} }),
    ]);
    expect(result.driftPolicy).toEqual(expect.objectContaining({ requireSameToolOrder: true, allowAdditionalTools: false }));
    expect(result.acceptedExamples).toEqual([
      expect.objectContaining({ referenceExecutionId: 'exec-1', referenceExecutionNumber: 7 }),
    ]);
    expect(result.outputContract?.type).toBe(FlowReplayOutputContractType.JSON_SCHEMA);
    expect(result.semanticChecklist).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'intent', source: 'intent' }),
      expect.objectContaining({ key: 'context:taskTitle', source: 'context' }),
    ]));
  });

  it('hashes tool configuration from node metadata instead of historical tool usage', () => {
    const baseline = service.buildValidatedReplayBaseline({
      taskId: 'task-1',
      referenceExecutionId: 'exec-1',
      referenceExecutionNumber: 1,
      mode: 'replay_strict',
      inputContext: { query: 'hello' },
      flowSnapshot: { nodes: [{ id: 'task-1' }] },
      nodeSnapshot: {
        id: 'task-1',
        modelId: 'gpt-4o-mini',
        metadata: { agent_model: 'gpt-4o-mini' },
      },
      taskResult: {
        output: { summary: 'ok' },
        toolTrace: [
          { callIndex: 1, toolName: 'search', args: {}, status: 'completed' },
        ],
        reasoningChain: [],
      },
      preserveOutputFormat: false,
    });

    const current = service.buildCurrentReplayFingerprints({
      inputContext: { query: 'hello' },
      flowSnapshot: { nodes: [{ id: 'task-1' }] },
      nodeSnapshot: {
        id: 'task-1',
        modelId: 'gpt-4o-mini',
        metadata: { agent_model: 'gpt-4o-mini' },
      },
      outputContract: baseline.outputContract,
    });

    expect(baseline.fingerprints.toolConfigHash).toBeNull();
    expect(current.toolConfigHash).toBeNull();
  });

  it('extracts markdown section contracts conservatively', () => {
    const result = service.buildValidatedReplayBaseline({
      taskId: 'task-1',
      referenceExecutionId: 'exec-1',
      referenceExecutionNumber: 1,
      mode: 'replay_flex',
      taskResult: {
        output: '# Summary\nHello\n## Risks\nNone',
        toolTrace: [],
        reasoningChain: [],
      },
      preserveOutputFormat: false,
      outputFormatGuide: 'Include citations for each section.',
    });

    expect(result.outputContract).toEqual(expect.objectContaining({
      type: FlowReplayOutputContractType.MARKDOWN_SECTIONS,
      requiredSections: ['Summary', 'Risks'],
      citationPolicy: 'optional',
    }));
  });

  it('preserves existing json schema contract when replay output was stringified', () => {
    const existingContract = {
      type: FlowReplayOutputContractType.JSON_SCHEMA,
      requiredSections: [],
      forbiddenSections: [],
      jsonSchema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
      citationPolicy: 'optional' as const,
    };

    const result = service.buildOutputContractFromReplay({
      output: '{"summary":"ok"}',
      preserveOutputFormat: true,
      outputFormatGuide: 'Keep same schema and add citations.',
      existingOutputContract: existingContract,
    });

    expect(result).toEqual({
      ...existingContract,
      citationPolicy: 'optional',
    });
  });

  it('drops existing json schema contract when output format preservation is disabled', () => {
    const existingContract = {
      type: FlowReplayOutputContractType.JSON_SCHEMA,
      requiredSections: [],
      forbiddenSections: [],
      jsonSchema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
      citationPolicy: 'optional' as const,
    };

    const result = service.buildOutputContractFromReplay({
      output: '{"summary":"ok"}',
      preserveOutputFormat: false,
      outputFormatGuide: null,
      existingOutputContract: existingContract,
    });

    expect(result).toBeNull();
  });

  it('builds current replay fingerprints from comparable execution context', () => {
    const result = service.buildCurrentReplayFingerprints({
      inputContext: { brief: 'hello' },
      flowSnapshot: { nodes: [{ id: 'task-1', metadata: { version: 1 } }] },
      nodeSnapshot: { id: 'task-1', modelId: 'gpt-4o-mini', metadata: { agent_model: 'gpt-4o-mini', agent_tools: ['search'] } },
      outputContract: null,
    });

    expect(result.inputContextHash).toBeTruthy();
    expect(result.flowSnapshotHash).toBeTruthy();
    expect(result.nodeSnapshotHash).toBeTruthy();
    expect(result.modelConfigHash).toBeTruthy();
  });
});
