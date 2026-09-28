import { Test, TestingModule } from '@nestjs/testing';
import { PlaybookFlowRepeatabilityService } from './playbook-flow-repeatability.service';
import { LoggerService } from '@modules/logger';
import { FlowReplayOutputContractType, FlowReplayValidationStatus } from '../interfaces/playbook-flow-validated-replay.interface';
import { PlaybookFlowOutputContractService } from './playbook-flow-output-contract.service';
import { FlowRepository } from '../persistence/flow.repository';
import { ExecutionRepository } from '../persistence/execution.repository';
import { TaskResultRepository } from '../persistence/task-result.repository';
import { ValidatedReplayRepository } from '../persistence/validated-replay.repository';
import { EvaluationExecutionRepository } from '../persistence/evaluation-execution.repository';

const completedRuns = [
  { id: 'exec-1', endedAt: new Date('2026-01-01T00:00:00Z') },
  { id: 'exec-2', endedAt: new Date('2026-01-02T00:00:00Z') },
];

const stepFlow = { id: 'f1', nodes: [{ id: 't1', kind: 'step', label: 'Step 1', metadata: {} }] };

describe('PlaybookFlowRepeatabilityService', () => {
  let service: PlaybookFlowRepeatabilityService;
  let flows: { findById: jest.Mock };
  let executions: { countByFlow: jest.Mock; listByFlow: jest.Mock };
  let taskResults: { listForExecution: jest.Mock };
  let replays: { listActiveForTasks: jest.Mock };
  let evaluations: { findLatestForTask: jest.Mock };

  /** Each run's completed result of the task (the first iteration, as the service asks for it). */
  const taskResultsByRun = (byRun: Record<string, Record<string, unknown>>) =>
    taskResults.listForExecution.mockImplementation(async (executionId: string) => (byRun[executionId] ? [{ executionId, taskId: 't1', status: 'completed', ...byRun[executionId] }] : []));

  const activeReplay = (overrides: Record<string, unknown>) =>
    replays.listActiveForTasks.mockResolvedValue([{ id: 'replay-1', flowId: 'f1', taskId: 't1', status: FlowReplayValidationStatus.ACTIVE, ...overrides }]);

  beforeEach(async () => {
    flows = { findById: jest.fn().mockResolvedValue(null) };
    executions = { countByFlow: jest.fn().mockResolvedValue(0), listByFlow: jest.fn().mockResolvedValue([]) };
    taskResults = { listForExecution: jest.fn().mockResolvedValue([]) };
    replays = { listActiveForTasks: jest.fn().mockResolvedValue([]) };
    evaluations = { findLatestForTask: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybookFlowRepeatabilityService,
        PlaybookFlowOutputContractService,
        { provide: FlowRepository, useValue: flows },
        { provide: ExecutionRepository, useValue: executions },
        { provide: TaskResultRepository, useValue: taskResults },
        { provide: ValidatedReplayRepository, useValue: replays },
        { provide: EvaluationExecutionRepository, useValue: evaluations },
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
      const result = await service.getRepeatability('f1');
      expect(flows.findById).toHaveBeenCalledWith('f1');
      expect(result.flowId).toBe('f1');
      expect(result.totalIterations).toBe(0);
    });

    it('returns empty summary when no step nodes exist', async () => {
      flows.findById.mockResolvedValue({ id: 'f1', nodes: [], workspaces: [] });
      const result = await service.getRepeatability('f1');
      expect(result.totalIterations).toBe(0);
      expect(executions.countByFlow).not.toHaveBeenCalled();
    });

    it('returns early when fewer than MIN_ITERATIONS executions', async () => {
      flows.findById.mockResolvedValue({ id: 'f1', nodes: [{ id: 't1', kind: 'step', label: 'Step 1' }] });
      executions.countByFlow.mockResolvedValue(1);
      const result = await service.getRepeatability('f1');
      expect(executions.countByFlow).toHaveBeenCalledWith('f1', ['completed']);
      expect(result.totalIterations).toBe(1);
      expect(result.evaluatedIterations).toBe(0);
      expect(result.iterations).toEqual([]);
      expect(executions.listByFlow).not.toHaveBeenCalled();
    });

    it('keeps legacy text-only baselines evaluated when no output contract exists', async () => {
      flows.findById.mockResolvedValue(stepFlow);
      executions.countByFlow.mockResolvedValue(2);
      executions.listByFlow.mockResolvedValue(completedRuns);
      activeReplay({ mode: 'replay_flex', referenceOutput: 'Exact expected sentence', toolPolicy: null, outputContract: null });
      taskResultsByRun({
        'exec-1': { output: 'Exact expected sentence', endedAt: new Date('2026-01-01T00:00:00Z') },
        'exec-2': { output: 'Exact expected sentence', endedAt: new Date('2026-01-02T00:00:00Z') },
      });

      const result = await service.getRepeatability('f1');

      expect(executions.listByFlow).toHaveBeenCalledWith('f1', { statuses: ['completed'] });
      expect(replays.listActiveForTasks).toHaveBeenCalledWith('f1', ['t1']);
      expect(taskResults.listForExecution).toHaveBeenCalledWith('exec-1', { taskIds: ['t1'], statuses: ['completed'], light: true, with: ['output', 'toolTrace'] });
      expect(evaluations.findLatestForTask).toHaveBeenCalledWith('exec-1', 't1');
      expect(result.evaluatedIterations).toBe(2);
      expect(result.passedIterations).toBe(2);
      expect(result.iterations.map((iteration) => [iteration.executionId, iteration.completedAt])).toEqual([
        ['exec-1', new Date('2026-01-01T00:00:00Z')],
        ['exec-2', new Date('2026-01-02T00:00:00Z')],
      ]);
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
      flows.findById.mockResolvedValue(stepFlow);
      executions.countByFlow.mockResolvedValue(2);
      executions.listByFlow.mockResolvedValue(completedRuns);
      activeReplay({
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
      });
      taskResultsByRun({
        'exec-1': { output: { summary: 'different wording', score: 2 }, endedAt: new Date('2026-01-01T00:00:00Z') },
        'exec-2': { output: { summary: 'another phrasing', score: 3 }, endedAt: new Date('2026-01-02T00:00:00Z') },
      });
      evaluations.findLatestForTask.mockResolvedValue({ semanticScore: 90 });

      const result = await service.getRepeatability('f1');

      expect(result.evaluatedIterations).toBe(2);
      expect(result.passedIterations).toBe(2);
      expect(result.iterations[0].tasks[0]).toEqual(expect.objectContaining({
        structuralEvaluated: true,
        structuralPassed: true,
        structuralScore: 100,
        toolPolicyScore: null,
        matchScore: 88.8,
        contentScore: 90,
        passed: true,
      }));
    });

    it('fails repeatability explicitly when markdown required sections are missing', async () => {
      flows.findById.mockResolvedValue(stepFlow);
      executions.countByFlow.mockResolvedValue(2);
      executions.listByFlow.mockResolvedValue(completedRuns);
      activeReplay({
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
      });
      taskResultsByRun({
        'exec-1': { output: '# Summary\nHello', endedAt: new Date('2026-01-01T00:00:00Z') },
        'exec-2': { output: '# Summary\nHello', endedAt: new Date('2026-01-02T00:00:00Z') },
      });
      evaluations.findLatestForTask.mockResolvedValue({ semanticScore: 95 });

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
      flows.findById.mockResolvedValue(stepFlow);
      executions.countByFlow.mockResolvedValue(2);
      executions.listByFlow.mockResolvedValue(completedRuns);
      activeReplay({
        mode: 'replay_strict',
        referenceOutput: 'Exact expected sentence',
        toolPolicy: { requiredTools: ['search'], forbiddenTools: [], sequencingRules: [], requireSameOrder: false },
        outputContract: null,
      });
      taskResultsByRun({
        'exec-1': { output: 'Exact expected sentence', toolTrace: [], endedAt: new Date('2026-01-01T00:00:00Z') },
        'exec-2': { output: 'Exact expected sentence', toolTrace: [], endedAt: new Date('2026-01-02T00:00:00Z') },
      });

      const result = await service.getRepeatability('f1');

      expect(result.passedIterations).toBe(0);
      expect(result.iterations[0].tasks[0]).toEqual(expect.objectContaining({
        toolPolicyScore: 0,
        passed: false,
      }));
    });

    it('treats a legacy strict_replay baseline as strict', async () => {
      flows.findById.mockResolvedValue(stepFlow);
      executions.countByFlow.mockResolvedValue(2);
      executions.listByFlow.mockResolvedValue(completedRuns);
      activeReplay({
        mode: 'strict_replay',
        referenceOutput: 'Exact expected sentence',
        toolPolicy: { requiredTools: ['search'], forbiddenTools: [], sequencingRules: [], requireSameOrder: false },
        outputContract: null,
      });
      taskResultsByRun({
        'exec-1': { output: 'Exact expected sentence', toolTrace: [] },
        'exec-2': { output: 'Exact expected sentence', toolTrace: [] },
      });

      const result = await service.getRepeatability('f1');

      expect(result.iterations[0].tasks[0]).toEqual(expect.objectContaining({ toolPolicyScore: 0, passed: false }));
    });

    it('fails strict repeatability when a forbidden tool is used', async () => {
      flows.findById.mockResolvedValue(stepFlow);
      executions.countByFlow.mockResolvedValue(2);
      executions.listByFlow.mockResolvedValue(completedRuns);
      activeReplay({
        mode: 'replay_strict',
        referenceOutput: 'Exact expected sentence',
        toolPolicy: { requiredTools: [], forbiddenTools: ['web-search'], sequencingRules: [], requireSameOrder: false },
        outputContract: null,
      });
      const toolTrace = [{ callIndex: 1, toolName: 'web-search', args: {}, status: 'completed' }];
      taskResultsByRun({
        'exec-1': { output: 'Exact expected sentence', toolTrace, endedAt: new Date('2026-01-01T00:00:00Z') },
        'exec-2': { output: 'Exact expected sentence', toolTrace, endedAt: new Date('2026-01-02T00:00:00Z') },
      });
      evaluations.findLatestForTask.mockResolvedValue({ semanticScore: 90 });

      const result = await service.getRepeatability('f1');

      expect(result.passedIterations).toBe(0);
      expect(result.iterations[0].tasks[0]).toEqual(expect.objectContaining({
        toolPolicyScore: 0,
        passed: false,
      }));
    });

    it('fails strict repeatability when required tool order is violated', async () => {
      flows.findById.mockResolvedValue(stepFlow);
      executions.countByFlow.mockResolvedValue(2);
      executions.listByFlow.mockResolvedValue(completedRuns);
      activeReplay({
        mode: 'replay_strict',
        referenceOutput: 'Exact expected sentence',
        toolPolicy: { requiredTools: ['search', 'calculator'], forbiddenTools: [], sequencingRules: ['Call search before calculator.'], requireSameOrder: true },
        outputContract: null,
      });
      const toolTrace = [{ callIndex: 1, toolName: 'calculator', args: {}, status: 'completed' }, { callIndex: 2, toolName: 'search', args: {}, status: 'completed' }];
      taskResultsByRun({
        'exec-1': { output: 'Exact expected sentence', toolTrace, endedAt: new Date('2026-01-01T00:00:00Z') },
        'exec-2': { output: 'Exact expected sentence', toolTrace, endedAt: new Date('2026-01-02T00:00:00Z') },
      });
      evaluations.findLatestForTask.mockResolvedValue({ semanticScore: 90 });

      const result = await service.getRepeatability('f1');

      expect(result.passedIterations).toBe(0);
      expect(result.iterations[0].tasks[0]).toEqual(expect.objectContaining({
        toolPolicyScore: 50,
        passed: false,
      }));
    });

    it('keeps flex-mode forbidden tool usage auditable without failing the task', async () => {
      flows.findById.mockResolvedValue(stepFlow);
      executions.countByFlow.mockResolvedValue(2);
      executions.listByFlow.mockResolvedValue(completedRuns);
      activeReplay({
        mode: 'replay_flex',
        referenceOutput: 'Exact expected sentence',
        toolPolicy: { requiredTools: [], forbiddenTools: ['web-search'], sequencingRules: [], requireSameOrder: false },
        outputContract: null,
      });
      const toolTrace = [{ callIndex: 1, toolName: 'web-search', args: {}, status: 'completed' }];
      taskResultsByRun({
        'exec-1': { output: 'Exact expected sentence', toolTrace, endedAt: new Date('2026-01-01T00:00:00Z') },
        'exec-2': { output: 'Exact expected sentence', toolTrace, endedAt: new Date('2026-01-02T00:00:00Z') },
      });
      evaluations.findLatestForTask.mockResolvedValue({ semanticScore: 90 });

      const result = await service.getRepeatability('f1');

      expect(result.iterations[0].tasks[0]).toEqual(expect.objectContaining({
        toolPolicyScore: 0,
        passed: true,
      }));
      expect(result.iterations[0].averageToolPolicyScore).toBe(0);
      expect(result.overallAverageToolPolicyScore).toBe(0);
    });

    it('marks a task not evaluated when the run has no completed result and no baseline', async () => {
      flows.findById.mockResolvedValue(stepFlow);
      executions.countByFlow.mockResolvedValue(2);
      executions.listByFlow.mockResolvedValue(completedRuns);

      const result = await service.getRepeatability('f1');

      expect(result.evaluatedIterations).toBe(0);
      expect(result.iterations[0].tasks[0]).toEqual(expect.objectContaining({ output: null, completedAt: null, matchState: 'not_evaluated', evaluated: false }));
    });

    it('pages the evaluated iterations with limit and offset', async () => {
      flows.findById.mockResolvedValue(stepFlow);
      executions.countByFlow.mockResolvedValue(2);
      executions.listByFlow.mockResolvedValue(completedRuns);

      const result = await service.getRepeatability('f1', 1, 1);

      expect(result.totalIterations).toBe(2);
      expect(result.iterations.map((iteration) => iteration.executionId)).toEqual(['exec-2']);
    });
  });

  describe('getTaskRepeatability', () => {
    it('returns null when flow not found', async () => {
      const result = await service.getTaskRepeatability('f1', 't1');
      expect(result).toBeNull();
    });

    it('returns null when task node not found', async () => {
      flows.findById.mockResolvedValue({ id: 'f1', nodes: [{ id: 't2', kind: 'step' }] });
      const result = await service.getTaskRepeatability('f1', 't1');
      expect(result).toBeNull();
    });

    it('evaluates the task in the latest completed runs', async () => {
      flows.findById.mockResolvedValue(stepFlow);
      executions.listByFlow.mockResolvedValue(completedRuns);
      activeReplay({ mode: 'replay_flex', referenceOutput: 'Expected', toolPolicy: null, outputContract: null });
      taskResultsByRun({ 'exec-1': { output: 'Expected' }, 'exec-2': { output: 'Something else entirely' } });

      const result = await service.getTaskRepeatability('f1', 't1', 2);

      expect(executions.listByFlow).toHaveBeenCalledWith('f1', { statuses: ['completed'], limit: 2 });
      expect(result?.map((task) => [task.output, task.passed])).toEqual([['Expected', true], ['Something else entirely', false]]);
    });
  });
});
