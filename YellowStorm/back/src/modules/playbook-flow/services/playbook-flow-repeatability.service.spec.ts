import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { PlaybookFlowRepeatabilityService } from './playbook-flow-repeatability.service';
import { LoggerService } from '@modules/logger';
import { FlowReplayOutputContractType, FlowReplayValidationStatus } from '../schemas/playbook-flow-validated-replay.schema';
import { PlaybookFlowOutputContractService } from './playbook-flow-output-contract.service';

const mockChain = () => ({
  exec: jest.fn().mockResolvedValue(null),
  lean: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
});

function makeChain(returnValue: unknown) {
  const chain = mockChain();
  chain.exec.mockResolvedValue(returnValue);
  return chain;
}

const mockModel = () => ({
  findById: jest.fn().mockReturnValue(makeChain(null)),
  find: jest.fn().mockReturnValue(makeChain([])),
  findOne: jest.fn().mockReturnValue(makeChain(null)),
  countDocuments: jest.fn().mockResolvedValue(0),
});

describe('PlaybookFlowRepeatabilityService', () => {
  let service: PlaybookFlowRepeatabilityService;
  let flowM: ReturnType<typeof mockModel>;
  let execM: ReturnType<typeof mockModel>;
  let taskM: ReturnType<typeof mockModel>;
  let replayM: ReturnType<typeof mockModel>;
  let evalM: ReturnType<typeof mockModel>;

  beforeEach(async () => {
    flowM = mockModel();
    execM = mockModel();
    taskM = mockModel();
    replayM = mockModel();
    evalM = mockModel();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybookFlowRepeatabilityService,
        PlaybookFlowOutputContractService,
        { provide: getModelToken('Flow'), useValue: flowM },
        { provide: getModelToken('FlowExecution'), useValue: execM },
        { provide: getModelToken('FlowTaskResult'), useValue: taskM },
        { provide: getModelToken('FlowValidatedReplay'), useValue: replayM },
        { provide: getModelToken('FlowEvaluationExecution'), useValue: evalM },
        { provide: LoggerService, useValue: { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } },
      ],
    }).compile();

    service = module.get<PlaybookFlowRepeatabilityService>(PlaybookFlowRepeatabilityService);
  });

  describe('resolveExpectedResult', () => {
    it('prefers node metadata over golden baseline', () => {
      const result = service.resolveExpectedResult(
        { metadata: { expectedResult: 'node value' } },
        { mode: null, referenceOutput: 'golden value', toolPolicy: null, outputContract: null },
      );
      expect(result.value).toBe('node value');
      expect(result.source).toBe('node_metadata');
    });

    it('falls back to golden baseline', () => {
      const result = service.resolveExpectedResult({}, { mode: null, referenceOutput: 'golden value', toolPolicy: null, outputContract: null });
      expect(result.value).toBe('golden value');
      expect(result.source).toBe('golden_baseline');
    });

    it('returns none when both are absent', () => {
      const result = service.resolveExpectedResult({}, null);
      expect(result.value).toBeNull();
      expect(result.source).toBe('none');
    });
  });

  describe('getRepeatability', () => {
    it('returns empty summary when flow not found', async () => {
      flowM.findById.mockReturnValue(makeChain(null));
      const result = await service.getRepeatability('f1');
      expect(result.flowId).toBe('f1');
      expect(result.totalIterations).toBe(0);
    });

    it('returns empty summary when no step nodes exist', async () => {
      flowM.findById.mockReturnValue(makeChain({ _id: 'f1', nodes: [], workspaces: [] }));
      const result = await service.getRepeatability('f1');
      expect(result.totalIterations).toBe(0);
    });

    it('returns early when fewer than MIN_ITERATIONS executions', async () => {
      flowM.findById.mockReturnValue(makeChain({ _id: 'f1', nodes: [{ id: 't1', kind: 'step', label: 'Step 1' }] }));
      execM.countDocuments.mockResolvedValue(1);
      const result = await service.getRepeatability('f1');
      expect(result.totalIterations).toBe(1);
      expect(result.evaluatedIterations).toBe(0);
      expect(result.iterations).toEqual([]);
    });

    it('keeps legacy text-only baselines evaluated when no output contract exists', async () => {
      flowM.findById.mockReturnValue(makeChain({
        _id: 'f1',
        nodes: [{ id: 't1', kind: 'step', label: 'Step 1', metadata: {} }],
      }));
      execM.countDocuments.mockResolvedValue(2);
      execM.find.mockReturnValue(makeChain([
        { _id: 'exec-1', endedAt: new Date('2026-01-01T00:00:00Z') },
        { _id: 'exec-2', endedAt: new Date('2026-01-02T00:00:00Z') },
      ]));
      execM.findById.mockImplementation((id: string) => makeChain({ _id: id, endedAt: new Date('2026-01-01T00:00:00Z') }));
      replayM.find.mockReturnValue(makeChain([{
        taskId: 't1',
        status: FlowReplayValidationStatus.ACTIVE,
        mode: 'replay_flex',
        referenceOutput: 'Exact expected sentence',
        toolPolicy: null,
        outputContract: null,
      }]));
      taskM.findOne
        .mockReturnValueOnce(makeChain({ executionId: 'exec-1', taskId: 't1', status: 'completed', output: 'Exact expected sentence', endedAt: new Date('2026-01-01T00:00:00Z') }))
        .mockReturnValueOnce(makeChain({ executionId: 'exec-2', taskId: 't1', status: 'completed', output: 'Exact expected sentence', endedAt: new Date('2026-01-02T00:00:00Z') }));
      evalM.findOne.mockReturnValue(makeChain(null));

      const result = await service.getRepeatability('f1');

      expect(result.evaluatedIterations).toBe(2);
      expect(result.passedIterations).toBe(2);
      expect(result.iterations[0].tasks[0]).toEqual(expect.objectContaining({
        structuralEvaluated: true,
        structuralPassed: true,
        toolPolicyScore: null,
        textMatchScore: 100,
        matchScore: 100,
        passed: true,
      }));
    });

    it('passes repeatability when wording changes but the json contract and content score pass', async () => {
      flowM.findById.mockReturnValue(makeChain({
        _id: 'f1',
        nodes: [{ id: 't1', kind: 'step', label: 'Step 1', metadata: {} }],
      }));
      execM.countDocuments.mockResolvedValue(2);
      execM.find.mockReturnValue(makeChain([
        { _id: 'exec-1', endedAt: new Date('2026-01-01T00:00:00Z') },
        { _id: 'exec-2', endedAt: new Date('2026-01-02T00:00:00Z') },
      ]));
      execM.findById.mockImplementation((id: string) => makeChain({ _id: id, endedAt: new Date('2026-01-01T00:00:00Z') }));
      replayM.find.mockReturnValue(makeChain([{
        taskId: 't1',
        status: FlowReplayValidationStatus.ACTIVE,
        mode: 'replay_flex',
        referenceOutput: '{"summary":"hello","score":1}',
        toolPolicy: null,
        outputContract: {
          type: FlowReplayOutputContractType.JSON_SCHEMA,
          requiredSections: [],
          forbiddenSections: [],
          jsonSchema: {
            type: 'object',
            properties: { summary: { type: 'string' }, score: { type: 'number' } },
            required: ['summary', 'score'],
          },
          citationPolicy: 'optional',
        },
      }]));
      taskM.findOne
        .mockReturnValueOnce(makeChain({ executionId: 'exec-1', taskId: 't1', status: 'completed', output: { summary: 'different wording', score: 2 }, endedAt: new Date('2026-01-01T00:00:00Z') }))
        .mockReturnValueOnce(makeChain({ executionId: 'exec-2', taskId: 't1', status: 'completed', output: { summary: 'another phrasing', score: 3 }, endedAt: new Date('2026-01-02T00:00:00Z') }));
      evalM.findOne.mockReturnValue(makeChain({ semanticScore: 90 }));

      const result = await service.getRepeatability('f1');

      expect(result.evaluatedIterations).toBe(2);
      expect(result.passedIterations).toBe(2);
      expect(result.iterations[0].tasks[0]).toEqual(expect.objectContaining({
        structuralEvaluated: true,
        structuralPassed: true,
        structuralScore: 100,
        toolPolicyScore: null,
        matchScore: 88.8,
        passed: true,
      }));
    });

    it('fails repeatability explicitly when markdown required sections are missing', async () => {
      flowM.findById.mockReturnValue(makeChain({
        _id: 'f1',
        nodes: [{ id: 't1', kind: 'step', label: 'Step 1', metadata: {} }],
      }));
      execM.countDocuments.mockResolvedValue(2);
      execM.find.mockReturnValue(makeChain([
        { _id: 'exec-1', endedAt: new Date('2026-01-01T00:00:00Z') },
        { _id: 'exec-2', endedAt: new Date('2026-01-02T00:00:00Z') },
      ]));
      execM.findById.mockImplementation((id: string) => makeChain({ _id: id, endedAt: new Date('2026-01-01T00:00:00Z') }));
      replayM.find.mockReturnValue(makeChain([{
        taskId: 't1',
        status: FlowReplayValidationStatus.ACTIVE,
        mode: 'replay_flex',
        referenceOutput: '# Summary\nHello\n## Risks\nNone',
        toolPolicy: null,
        outputContract: {
          type: FlowReplayOutputContractType.MARKDOWN_SECTIONS,
          requiredSections: ['Summary', 'Risks'],
          forbiddenSections: ['Notes'],
          jsonSchema: null,
          citationPolicy: 'optional',
        },
      }]));
      taskM.findOne
        .mockReturnValueOnce(makeChain({ executionId: 'exec-1', taskId: 't1', status: 'completed', output: '# Summary\nHello', endedAt: new Date('2026-01-01T00:00:00Z') }))
        .mockReturnValueOnce(makeChain({ executionId: 'exec-2', taskId: 't1', status: 'completed', output: '# Summary\nHello', endedAt: new Date('2026-01-02T00:00:00Z') }));
      evalM.findOne.mockReturnValue(makeChain({ semanticScore: 95 }));

      const result = await service.getRepeatability('f1');

      expect(result.passedIterations).toBe(0);
      expect(result.iterations[0].tasks[0]).toEqual(expect.objectContaining({
        structuralPassed: false,
        structuralScore: 66.7,
        structuralDriftReasons: ['missing_required_section:Risks'],
        toolPolicyScore: null,
        passed: false,
      }));
    });

    it('fails strict repeatability when a required tool is missing', async () => {
      flowM.findById.mockReturnValue(makeChain({
        _id: 'f1',
        nodes: [{ id: 't1', kind: 'step', label: 'Step 1', metadata: {} }],
      }));
      execM.countDocuments.mockResolvedValue(2);
      execM.find.mockReturnValue(makeChain([
        { _id: 'exec-1', endedAt: new Date('2026-01-01T00:00:00Z') },
        { _id: 'exec-2', endedAt: new Date('2026-01-02T00:00:00Z') },
      ]));
      execM.findById.mockImplementation((id: string) => makeChain({ _id: id, endedAt: new Date('2026-01-01T00:00:00Z') }));
      replayM.find.mockReturnValue(makeChain([{
        taskId: 't1',
        status: FlowReplayValidationStatus.ACTIVE,
        mode: 'replay_strict',
        referenceOutput: 'Exact expected sentence',
        toolPolicy: {
          requiredTools: ['search'],
          forbiddenTools: [],
          sequencingRules: [],
          requireSameOrder: false,
        },
        outputContract: null,
      }]));
      taskM.findOne
        .mockReturnValueOnce(makeChain({ executionId: 'exec-1', taskId: 't1', status: 'completed', output: 'Exact expected sentence', toolTrace: [], endedAt: new Date('2026-01-01T00:00:00Z') }))
        .mockReturnValueOnce(makeChain({ executionId: 'exec-2', taskId: 't1', status: 'completed', output: 'Exact expected sentence', toolTrace: [], endedAt: new Date('2026-01-02T00:00:00Z') }));
      evalM.findOne.mockReturnValue(makeChain(null));

      const result = await service.getRepeatability('f1');

      expect(result.passedIterations).toBe(0);
      expect(result.iterations[0].tasks[0]).toEqual(expect.objectContaining({
        toolPolicyScore: 0,
        passed: false,
      }));
    });

    it('fails strict repeatability when a forbidden tool is used', async () => {
      flowM.findById.mockReturnValue(makeChain({
        _id: 'f1',
        nodes: [{ id: 't1', kind: 'step', label: 'Step 1', metadata: {} }],
      }));
      execM.countDocuments.mockResolvedValue(2);
      execM.find.mockReturnValue(makeChain([
        { _id: 'exec-1', endedAt: new Date('2026-01-01T00:00:00Z') },
        { _id: 'exec-2', endedAt: new Date('2026-01-02T00:00:00Z') },
      ]));
      execM.findById.mockImplementation((id: string) => makeChain({ _id: id, endedAt: new Date('2026-01-01T00:00:00Z') }));
      replayM.find.mockReturnValue(makeChain([{
        taskId: 't1',
        status: FlowReplayValidationStatus.ACTIVE,
        mode: 'replay_strict',
        referenceOutput: 'Exact expected sentence',
        toolPolicy: {
          requiredTools: [],
          forbiddenTools: ['web-search'],
          sequencingRules: [],
          requireSameOrder: false,
        },
        outputContract: null,
      }]));
      taskM.findOne
        .mockReturnValueOnce(makeChain({ executionId: 'exec-1', taskId: 't1', status: 'completed', output: 'Exact expected sentence', toolTrace: [{ callIndex: 1, toolName: 'web-search', args: {}, status: 'completed' }], endedAt: new Date('2026-01-01T00:00:00Z') }))
        .mockReturnValueOnce(makeChain({ executionId: 'exec-2', taskId: 't1', status: 'completed', output: 'Exact expected sentence', toolTrace: [{ callIndex: 1, toolName: 'web-search', args: {}, status: 'completed' }], endedAt: new Date('2026-01-02T00:00:00Z') }));
      evalM.findOne.mockReturnValue(makeChain({ semanticScore: 90 }));

      const result = await service.getRepeatability('f1');

      expect(result.passedIterations).toBe(0);
      expect(result.iterations[0].tasks[0]).toEqual(expect.objectContaining({
        toolPolicyScore: 0,
        passed: false,
      }));
    });

    it('fails strict repeatability when required tool order is violated', async () => {
      flowM.findById.mockReturnValue(makeChain({
        _id: 'f1',
        nodes: [{ id: 't1', kind: 'step', label: 'Step 1', metadata: {} }],
      }));
      execM.countDocuments.mockResolvedValue(2);
      execM.find.mockReturnValue(makeChain([
        { _id: 'exec-1', endedAt: new Date('2026-01-01T00:00:00Z') },
        { _id: 'exec-2', endedAt: new Date('2026-01-02T00:00:00Z') },
      ]));
      execM.findById.mockImplementation((id: string) => makeChain({ _id: id, endedAt: new Date('2026-01-01T00:00:00Z') }));
      replayM.find.mockReturnValue(makeChain([{
        taskId: 't1',
        status: FlowReplayValidationStatus.ACTIVE,
        mode: 'replay_strict',
        referenceOutput: 'Exact expected sentence',
        toolPolicy: {
          requiredTools: ['search', 'calculator'],
          forbiddenTools: [],
          sequencingRules: ['Call search before calculator.'],
          requireSameOrder: true,
        },
        outputContract: null,
      }]));
      taskM.findOne
        .mockReturnValueOnce(makeChain({ executionId: 'exec-1', taskId: 't1', status: 'completed', output: 'Exact expected sentence', toolTrace: [{ callIndex: 1, toolName: 'calculator', args: {}, status: 'completed' }, { callIndex: 2, toolName: 'search', args: {}, status: 'completed' }], endedAt: new Date('2026-01-01T00:00:00Z') }))
        .mockReturnValueOnce(makeChain({ executionId: 'exec-2', taskId: 't1', status: 'completed', output: 'Exact expected sentence', toolTrace: [{ callIndex: 1, toolName: 'calculator', args: {}, status: 'completed' }, { callIndex: 2, toolName: 'search', args: {}, status: 'completed' }], endedAt: new Date('2026-01-02T00:00:00Z') }));
      evalM.findOne.mockReturnValue(makeChain({ semanticScore: 90 }));

      const result = await service.getRepeatability('f1');

      expect(result.passedIterations).toBe(0);
      expect(result.iterations[0].tasks[0]).toEqual(expect.objectContaining({
        toolPolicyScore: 50,
        passed: false,
      }));
    });

    it('keeps flex-mode forbidden tool usage auditable without failing the task', async () => {
      flowM.findById.mockReturnValue(makeChain({
        _id: 'f1',
        nodes: [{ id: 't1', kind: 'step', label: 'Step 1', metadata: {} }],
      }));
      execM.countDocuments.mockResolvedValue(2);
      execM.find.mockReturnValue(makeChain([
        { _id: 'exec-1', endedAt: new Date('2026-01-01T00:00:00Z') },
        { _id: 'exec-2', endedAt: new Date('2026-01-02T00:00:00Z') },
      ]));
      execM.findById.mockImplementation((id: string) => makeChain({ _id: id, endedAt: new Date('2026-01-01T00:00:00Z') }));
      replayM.find.mockReturnValue(makeChain([{
        taskId: 't1',
        status: FlowReplayValidationStatus.ACTIVE,
        mode: 'replay_flex',
        referenceOutput: 'Exact expected sentence',
        toolPolicy: {
          requiredTools: [],
          forbiddenTools: ['web-search'],
          sequencingRules: [],
          requireSameOrder: false,
        },
        outputContract: null,
      }]));
      taskM.findOne
        .mockReturnValueOnce(makeChain({ executionId: 'exec-1', taskId: 't1', status: 'completed', output: 'Exact expected sentence', toolTrace: [{ callIndex: 1, toolName: 'web-search', args: {}, status: 'completed' }], endedAt: new Date('2026-01-01T00:00:00Z') }))
        .mockReturnValueOnce(makeChain({ executionId: 'exec-2', taskId: 't1', status: 'completed', output: 'Exact expected sentence', toolTrace: [{ callIndex: 1, toolName: 'web-search', args: {}, status: 'completed' }], endedAt: new Date('2026-01-02T00:00:00Z') }));
      evalM.findOne.mockReturnValue(makeChain({ semanticScore: 90 }));

      const result = await service.getRepeatability('f1');

      expect(result.iterations[0].tasks[0]).toEqual(expect.objectContaining({
        toolPolicyScore: 0,
        passed: true,
      }));
      expect(result.iterations[0].averageToolPolicyScore).toBe(0);
      expect(result.overallAverageToolPolicyScore).toBe(0);
    });
  });

  describe('getTaskRepeatability', () => {
    it('returns null when flow not found', async () => {
      flowM.findById.mockReturnValue(makeChain(null));
      const result = await service.getTaskRepeatability('f1', 't1');
      expect(result).toBeNull();
    });

    it('returns null when task node not found', async () => {
      flowM.findById.mockReturnValue(makeChain({ _id: 'f1', nodes: [{ id: 't2', kind: 'step' }] }));
      const result = await service.getTaskRepeatability('f1', 't1');
      expect(result).toBeNull();
    });
  });
});
