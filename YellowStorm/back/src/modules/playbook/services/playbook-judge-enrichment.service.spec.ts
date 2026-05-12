import { Types } from 'mongoose';
import { PlaybookJudgeEnrichmentService } from './playbook-judge-enrichment.service';
import { JudgeStatus, StepStatus } from '../schemas/playbook-execution.schema';

describe('PlaybookJudgeEnrichmentService', () => {
  it('falls back to source workspaces when generated workspaces are invalid', async () => {
    const sourceWorkspace = new Types.ObjectId().toHexString();
    const playbookService = {
      findById: jest.fn().mockResolvedValue({
        id: 'playbook-1',
        name: 'Source Playbook',
        description: 'Source description',
        tasks: [{ id: 'task-1' }],
        edges: [{ id: 'edge-1' }],
        workspaces: [sourceWorkspace],
      }),
      createWithTasksAndEdges: jest.fn().mockResolvedValue({ id: 'generated-playbook' }),
    };

    const service = new PlaybookJudgeEnrichmentService(
      {} as any,
      {} as any,
      playbookService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { sanitizeEdgesForTasks: jest.fn((_: any[], edges: any[]) => edges) } as any,
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() } as any,
    );

    jest.spyOn(service as any, 'buildRewritePayload').mockResolvedValue({
      name: 'Generated Playbook',
      description: 'Generated description',
      tasks: [{ id: 'task-1' }],
      edges: [{ id: 'edge-1' }],
      workspaces: ['not-a-valid-object-id', 'still-not-valid'],
    });

    await service.generateNewPlaybook('user-1', 'playbook-1', 'execution-1');

    expect(playbookService.createWithTasksAndEdges).toHaveBeenCalledWith(
      'user-1',
      'Generated Playbook',
      'Generated description',
      expect.arrayContaining([expect.objectContaining({ id: 'task-1' })]),
      [{ id: 'edge-1' }],
      [sourceWorkspace],
    );
  });

  it('normalizes malformed advisor step payloads defensively', () => {
    const service = new PlaybookJudgeEnrichmentService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { sanitizeEdgesForTasks: jest.fn((_: any[], edges: any[]) => edges) } as any,
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() } as any,
    );

    const normalized = (service as any).normalizeNodeJudgePayload({
      overallScore: '87',
      resultMatchingScore: '76',
      confidence: 82,
      toolUsageScore: 'bad',
      expectedResultSource: 'golden_baseline',
      expectedResultType: 'document_generation',
      expectedResultMatched: true,
      expectedResultReason: '  Produced the required report artifact  ',
      missingFacts: ['fact', 1, null],
      toolSelectionIssues: 'wrong-shape',
      safeAutoFixType: 'delete_everything',
      recommendation: 'generate_new_optimized_playbook',
      reason: '  Needs workflow cleanup  ',
    }, 'model-a');

    expect(normalized).toEqual(expect.objectContaining({
      overallScore: 87,
      resultMatchingScore: 76,
      confidence: 0.82,
      toolUsageScore: 0,
      expectedResultSource: 'golden_baseline',
      expectedResultType: 'document_generation',
      expectedResultMatched: true,
      expectedResultReason: 'Produced the required report artifact',
      missingFacts: ['fact'],
      toolSelectionIssues: [],
      safeAutoFixType: 'none',
      recommendation: 'generate_new_optimized_playbook',
      reason: 'Needs workflow cleanup',
      _model: 'model-a',
    }));
  });

  it('normalizes malformed advisor execution summary payloads defensively', () => {
    const service = new PlaybookJudgeEnrichmentService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { sanitizeEdgesForTasks: jest.fn((_: any[], edges: any[]) => edges) } as any,
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() } as any,
    );

    const normalized = (service as any).normalizeExecutionSummaryPayload({
      overallScore: 101,
      confidence: '0.5',
      toolUsageIssues: ['duplicate calls', null],
      crossStepToolPatterns: 'invalid',
      recommendation: 'not-allowed',
    }, 'model-b');

    expect(normalized).toEqual(expect.objectContaining({
      overallScore: 100,
      confidence: 0.5,
      toolUsageIssues: ['duplicate calls'],
      crossStepToolPatterns: [],
      recommendation: 'update_current_playbook',
      _model: 'model-b',
    }));
  });

  it('claims summary evaluation before generating the execution summary', async () => {
    const executionId = new Types.ObjectId().toHexString();
    const executionModel = {
      findById: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: new Types.ObjectId(executionId),
            playbookId: new Types.ObjectId(),
            status: 'completed',
            judgeSummaryStatus: 'idle',
            taskResults: [
              { taskId: 'task-1', nodeTitle: 'Task 1', status: StepStatus.COMPLETED, judgeStatus: JudgeStatus.EVALUATED, judgeResult: { overallScore: 81 }, toolTrace: [], llmPromptTrace: [] },
            ],
          }),
        }),
      }),
      updateOne: jest.fn()
        .mockResolvedValueOnce({ modifiedCount: 1 })
        .mockResolvedValueOnce({ modifiedCount: 1 }),
    };
    const streamGateway = { sendToUser: jest.fn() };

    const service = new PlaybookJudgeEnrichmentService(
      executionModel as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ description: 'Goal' }) } as any,
      { findByKey: jest.fn().mockResolvedValue({ systemTemplate: 'sys', userTemplate: 'user {{nodeFindingsJson}}' }) } as any,
      { getHttpClient: jest.fn().mockReturnValue({ post: jest.fn().mockResolvedValue({ data: { choices: [{ message: { content: JSON.stringify({ overallScore: 88, confidence: 0.9, recommendation: 'update_current_playbook' }) } }], usage: { model: 'judge-model' } } }) }) } as any,
      { getDefaultModel: jest.fn().mockResolvedValue({ id: 'judge-model' }) } as any,
      {} as any,
      streamGateway as any,
      { sanitizeEdgesForTasks: jest.fn((_: any[], edges: any[]) => edges) } as any,
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() } as any,
    );

    await service.evaluateExecutionSummaryNowIfReady('user-1', executionId);

    expect(executionModel.updateOne).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ judgeSummaryStatus: { $in: ['idle', 'failed'] } }),
      expect.objectContaining({ $set: expect.objectContaining({ judgeSummaryStatus: 'evaluating' }) }),
    );
    expect(executionModel.updateOne).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ judgeSummaryStatus: 'evaluating' }),
      expect.objectContaining({ $set: expect.objectContaining({ judgeSummaryStatus: 'evaluated' }) }),
    );
    expect(streamGateway.sendToUser).toHaveBeenCalledWith('user-1', expect.objectContaining({ type: 'playbook_judge_summary_updated' }));
  });

  it('skips summary generation when another worker already claimed it', async () => {
    const executionId = new Types.ObjectId().toHexString();
    const httpPost = jest.fn();
    const executionModel = {
      findById: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: new Types.ObjectId(executionId),
            playbookId: new Types.ObjectId(),
            status: 'completed',
            judgeSummaryStatus: 'idle',
            taskResults: [
              { taskId: 'task-1', nodeTitle: 'Task 1', status: StepStatus.COMPLETED, judgeStatus: JudgeStatus.EVALUATED, judgeResult: { overallScore: 81 }, toolTrace: [], llmPromptTrace: [] },
            ],
          }),
        }),
      }),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    };

    const service = new PlaybookJudgeEnrichmentService(
      executionModel as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ description: 'Goal' }) } as any,
      { findByKey: jest.fn() } as any,
      { getHttpClient: jest.fn().mockReturnValue({ post: httpPost }) } as any,
      { getDefaultModel: jest.fn().mockResolvedValue({ id: 'judge-model' }) } as any,
      {} as any,
      { sendToUser: jest.fn() } as any,
      { sanitizeEdgesForTasks: jest.fn((_: any[], edges: any[]) => edges) } as any,
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() } as any,
    );

    await service.evaluateExecutionSummaryNowIfReady('user-1', executionId);

    expect(httpPost).not.toHaveBeenCalled();
    expect(executionModel.updateOne).toHaveBeenCalledTimes(1);
  });

  describe('applyRemediations', () => {
    const createApplyService = (parsedPayload: any, graphService: any, playbookService: any, execution: any) => {
      const executionModel = {
        findById: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(execution),
          }),
        }),
      };

      return new PlaybookJudgeEnrichmentService(
        executionModel as any,
        {} as any,
        playbookService as any,
        { findByKey: jest.fn().mockResolvedValue({ systemTemplate: 'sys', userTemplate: 'playbook {{playbookJson}}' }) } as any,
        { getHttpClient: jest.fn().mockReturnValue({ post: jest.fn().mockResolvedValue({ data: { choices: [{ message: { content: JSON.stringify(parsedPayload) } }], usage: { model: 'judge-model' } } }) }) } as any,
        { getDefaultModel: jest.fn().mockResolvedValue({ id: 'judge-model' }) } as any,
        { recordUsage: jest.fn().mockResolvedValue(undefined) } as any,
        { sendToUser: jest.fn() } as any,
        graphService as any,
        { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() } as any,
      );
    };

    it('persists sanitized rewritten edges for selected structural remediations', async () => {
      const originalEdges = [{ id: 'old-edge', sourceId: 'task-0', targetId: 'task-1' }];
      const rewrittenEdges = [{ id: 'new-edge', sourceId: 'task-1', targetId: 'task-2' }];
      const sanitizedEdges = [{ id: 'new-edge', sourceId: 'task-1', targetId: 'task-2' }];
      const playbookService = {
        findById: jest.fn().mockResolvedValue({
          id: 'playbook-1',
          name: 'Original',
          tasks: [{ id: 'task-1' }],
          edges: originalEdges,
        }),
        update: jest.fn().mockResolvedValue({ id: 'playbook-1' }),
      };
      const graphService = {
        sanitizeEdgesForTasks: jest.fn().mockReturnValue(sanitizedEdges),
      };
      const execution = {
        executedBy: 'user-1',
        playbookSnapshot: { tasks: [{ id: 'task-1' }], edges: originalEdges },
        judgeSummary: { highImpactRecommendations: ['Split task-1 into analysis and synthesis steps'] },
        taskResults: [],
      };
      const parsedTasks = [{ id: 'task-1' }, { id: 'task-2' }];
      const service = createApplyService({ name: 'Updated', tasks: parsedTasks, edges: rewrittenEdges }, graphService, playbookService, execution);

      await service.applyRemediations('user-1', 'playbook-1', 'execution-1', ['summary.highImpactRecommendations:playbook:0']);

      expect(graphService.sanitizeEdgesForTasks).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'task-1', advisorOptimizedAt: expect.any(Date) }),
          expect.objectContaining({ id: 'task-2' }),
        ]),
        rewrittenEdges,
      );
      expect(playbookService.update).toHaveBeenCalledWith('playbook-1', expect.objectContaining({
        edges: sanitizedEdges,
      }));
    });

    it('preserves existing edges for non-structural remediations', async () => {
      const originalEdges = [{ id: 'old-edge', sourceId: 'task-0', targetId: 'task-1' }];
      const rewrittenEdges = [{ id: 'ignored-edge', sourceId: 'task-1', targetId: 'task-2' }];
      const playbookService = {
        findById: jest.fn().mockResolvedValue({
          id: 'playbook-1',
          name: 'Original',
          tasks: [{ id: 'task-1' }],
          edges: originalEdges,
        }),
        update: jest.fn().mockResolvedValue({ id: 'playbook-1' }),
      };
      const graphService = {
        sanitizeEdgesForTasks: jest.fn(),
      };
      const execution = {
        executedBy: 'user-1',
        playbookSnapshot: { tasks: [{ id: 'task-1' }], edges: originalEdges },
        judgeSummary: {},
        taskResults: [{ taskId: 'task-1', judgeResult: { rewriteHints: ['Clarify the task instructions'] } }],
      };
      const service = createApplyService({ name: 'Updated', tasks: [{ id: 'task-1' }], edges: rewrittenEdges }, graphService, playbookService, execution);

      await service.applyRemediations('user-1', 'playbook-1', 'execution-1', ['rewriteHints:task-1:0']);

      expect(graphService.sanitizeEdgesForTasks).not.toHaveBeenCalled();
      expect(playbookService.update).toHaveBeenCalledWith('playbook-1', expect.objectContaining({
        edges: originalEdges,
      }));
    });

    it('falls back to existing edges when structural edge sanitization drops candidates', async () => {
      const originalEdges = [{ id: 'old-edge', sourceId: 'task-0', targetId: 'task-1' }];
      const rewrittenEdges = [
        { id: 'valid-edge', sourceId: 'task-1', targetId: 'task-2' },
        { id: 'invalid-edge', sourceId: 'task-2', targetId: 'missing-task' },
      ];
      const playbookService = {
        findById: jest.fn().mockResolvedValue({
          id: 'playbook-1',
          name: 'Original',
          tasks: [{ id: 'task-1' }],
          edges: originalEdges,
        }),
        update: jest.fn().mockResolvedValue({ id: 'playbook-1' }),
      };
      const graphService = {
        sanitizeEdgesForTasks: jest.fn().mockReturnValue([rewrittenEdges[0]]),
      };
      const execution = {
        executedBy: 'user-1',
        playbookSnapshot: { tasks: [{ id: 'task-1' }], edges: originalEdges },
        judgeSummary: { highImpactRecommendations: ['Split task-1 and reconnect downstream flow'] },
        taskResults: [],
      };
      const service = createApplyService(
        { name: 'Updated', tasks: [{ id: 'task-1' }, { id: 'task-2' }], edges: rewrittenEdges },
        graphService,
        playbookService,
        execution,
      );

      await service.applyRemediations('user-1', 'playbook-1', 'execution-1', ['summary.highImpactRecommendations:playbook:0']);

      expect(graphService.sanitizeEdgesForTasks).toHaveBeenCalled();
      expect(playbookService.update).toHaveBeenCalledWith('playbook-1', expect.objectContaining({
        edges: originalEdges,
      }));
    });

    it('renders rewrite prompt from the latest persisted playbook instead of the execution snapshot', async () => {
      const originalEdges = [{ id: 'edge-1', sourceId: 'task-0', targetId: 'task-1' }];
      const latestPlaybook = {
        id: 'playbook-1',
        name: 'Latest Playbook',
        description: 'latest description',
        tasks: [{ id: 'task-live', title: 'Latest task' }],
        edges: originalEdges,
      };
      const playbookService = {
        findById: jest.fn().mockResolvedValue(latestPlaybook),
        update: jest.fn().mockResolvedValue({ id: 'playbook-1' }),
      };
      const httpPost = jest.fn().mockResolvedValue({
        data: {
          choices: [{ message: { content: JSON.stringify({ name: 'Updated', tasks: [{ id: 'task-live' }], edges: originalEdges }) } }],
          usage: { model: 'judge-model' },
        },
      });
      const graphService = {
        sanitizeEdgesForTasks: jest.fn(),
      };
      const execution = {
        executedBy: 'user-1',
        playbookSnapshot: {
          name: 'Stale Snapshot',
          tasks: [{ id: 'task-stale', title: 'Old task' }],
          edges: [{ id: 'stale-edge', sourceId: 'old', targetId: 'task-stale' }],
        },
        judgeSummary: {},
        taskResults: [{ taskId: 'task-live', judgeResult: { rewriteHints: ['Clarify the task instructions'] } }],
      };
      const executionModel = {
        findById: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(execution),
          }),
        }),
      };
      const service = new PlaybookJudgeEnrichmentService(
        executionModel as any,
        {} as any,
        playbookService as any,
        { findByKey: jest.fn().mockResolvedValue({ systemTemplate: 'sys', userTemplate: 'PB={{playbookJson}}' }) } as any,
        { getHttpClient: jest.fn().mockReturnValue({ post: httpPost }) } as any,
        { getDefaultModel: jest.fn().mockResolvedValue({ id: 'judge-model' }) } as any,
        { recordUsage: jest.fn().mockResolvedValue(undefined) } as any,
        { sendToUser: jest.fn() } as any,
        graphService as any,
        { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() } as any,
      );

      await service.applyRemediations('user-1', 'playbook-1', 'execution-1', ['rewriteHints:task-live:0']);

      expect(httpPost).toHaveBeenCalledWith('/v1/chat/completions', expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('Latest Playbook'),
          }),
        ]),
      }), expect.any(Object));
      expect(httpPost).toHaveBeenCalledWith('/v1/chat/completions', expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.not.stringContaining('Stale Snapshot'),
          }),
        ]),
      }), expect.any(Object));
      expect(httpPost).toHaveBeenCalledWith('/v1/chat/completions', expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('Apply only the following remediation hints (exclude all others):'),
          }),
        ]),
      }), expect.any(Object));
    });
  });

  describe('resolveExpectedResult', () => {
    const createService = (findOneResult: any = null) => new PlaybookJudgeEnrichmentService(
      {} as any,
      {
        findOne: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnThis(),
          lean: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue(findOneResult),
        }),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { sanitizeEdgesForTasks: jest.fn((_: any[], edges: any[]) => edges) } as any,
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() } as any,
    );

    it('prioritizes node_field over golden_baseline over none', async () => {
      const playbookId = new Types.ObjectId().toHexString();

      const withNodeField = createService({ referenceOutput: 'Golden baseline value' });
      await expect((withNodeField as any).resolveExpectedResult(playbookId, {
        id: 'task-1',
        expectedResult: '  Node expected result  ',
      })).resolves.toEqual({
        value: 'Node expected result',
        source: 'node_field',
      });

      const withGoldenBaseline = createService({ referenceOutput: '  Golden baseline value  ' });
      await expect((withGoldenBaseline as any).resolveExpectedResult(playbookId, {
        id: 'task-1',
        expectedResult: '   ',
      })).resolves.toEqual({
        value: 'Golden baseline value',
        source: 'golden_baseline',
      });

      const withNone = createService(null);
      await expect((withNone as any).resolveExpectedResult(playbookId, {
        id: 'task-1',
        expectedResult: null,
      })).resolves.toEqual({
        value: '',
        source: 'none',
      });
    });
  });

  describe('sanitizeForPrompt', () => {
    it('redacts sensitive keys recursively in objects and arrays', () => {
      const service = new PlaybookJudgeEnrichmentService(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        { sanitizeEdgesForTasks: jest.fn((_: any[], edges: any[]) => edges) } as any,
        { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() } as any,
      );

      const sanitized = (service as any).sanitizeForPrompt({
        password: 'top-secret',
        nested: {
          authorization: 'Bearer token',
          profile: {
            sessionId: 'session-123',
            safe: 'visible',
          },
        },
        artifacts: [
          { apiKey: 'key-123', result: 'ok' },
          { credentials: { username: 'demo', secret: 'hidden' } },
        ],
        safeArray: ['a', 'b'],
      });

      expect(sanitized).toEqual({
        password: '[REDACTED]',
        nested: {
          authorization: '[REDACTED]',
          profile: {
            sessionId: '[REDACTED]',
            safe: 'visible',
          },
        },
        artifacts: [
          { apiKey: '[REDACTED]', result: 'ok' },
          { credentials: '[REDACTED]' },
        ],
        safeArray: ['a', 'b'],
      });
    });
  });
});
