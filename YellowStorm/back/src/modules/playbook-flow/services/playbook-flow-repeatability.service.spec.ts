import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { PlaybookFlowRepeatabilityService } from './playbook-flow-repeatability.service';
import { LoggerService } from '@modules/logger';
import { FlowReplayValidationStatus } from '../schemas/playbook-flow-validated-replay.schema';

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
        'golden value',
      );
      expect(result.value).toBe('node value');
      expect(result.source).toBe('node_metadata');
    });

    it('falls back to golden baseline', () => {
      const result = service.resolveExpectedResult({}, 'golden value');
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
