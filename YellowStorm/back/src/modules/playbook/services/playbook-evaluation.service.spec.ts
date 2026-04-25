import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PlaybookEvaluationService } from './playbook-evaluation.service';

describe('PlaybookEvaluationService', () => {
  let service: PlaybookEvaluationService;
  let executionModel: { findById: jest.Mock };
  let baselineModel: { findOne: jest.Mock; find: jest.Mock; updateMany: jest.Mock; create: jest.Mock };
  let evaluationExecutionModel: { findById: jest.Mock; find: jest.Mock; create: jest.Mock };
  let grpcService: { isAvailable: boolean; evaluateSemanticMatch: jest.Mock };
  let logger: { setContext: jest.Mock; warn: jest.Mock };

  beforeEach(() => {
    executionModel = { findById: jest.fn() };
    baselineModel = { findOne: jest.fn(), find: jest.fn(), updateMany: jest.fn(), create: jest.fn() };
    evaluationExecutionModel = { findById: jest.fn(), find: jest.fn(), create: jest.fn() };
    grpcService = { isAvailable: false, evaluateSemanticMatch: jest.fn() };
    logger = { setContext: jest.fn(), warn: jest.fn() };

    service = new PlaybookEvaluationService(
      executionModel as any,
      baselineModel as any,
      evaluationExecutionModel as any,
      grpcService as any,
      logger as any,
    );
  });

  it('normalizes valid evaluation config', () => {
    expect(service.normalizeTaskEvaluationConfig({
      evaluationConfig: {
        expectation: 'Check revenue and costs',
        passThreshold: 85,
        warningThreshold: 60,
        weight: 2,
      },
    } as any)).toMatchObject({
      expectation: 'Check revenue and costs',
      passThreshold: 85,
      warningThreshold: 60,
      weight: 2,
    });
  });

  it('rejects config when expectation and baseline are both missing', () => {
    expect(() => service.normalizeTaskEvaluationConfig({
      evaluationConfig: {
        expectation: '   ',
        referenceBaselineId: null,
      },
    } as any)).toThrow(BadRequestException);
  });

  it('rejects invalid thresholds', () => {
    expect(() => service.normalizeTaskEvaluationConfig({
      evaluationConfig: {
        expectation: 'Valid',
        passThreshold: 50,
        warningThreshold: 90,
      },
    } as any)).toThrow(BadRequestException);
  });

  it('creates baseline from execution using only evaluation upstream edges', async () => {
    const playbookId = new Types.ObjectId().toString();
    const executionId = new Types.ObjectId().toString();
    executionModel.findById.mockReturnValue({
      lean: () => ({
        exec: async () => ({
          playbookId: new Types.ObjectId(playbookId),
          playbookSnapshot: {
            tasks: [{ id: 'eval-1' }],
            edges: [
              { sourceId: 'source-a', sourceOutputPortId: 'out-a', targetId: 'eval-1', targetInputPortId: 'in-a' },
            ],
          },
          taskResults: [
            {
              taskId: 'source-a',
              output: 'kept',
              artifacts: [
                { artifactKind: 'text', sourcePortId: 'out-a', content: 'kept artifact' },
                { artifactKind: 'text', sourcePortId: 'other-port', content: 'ignored artifact' },
              ],
            },
            {
              taskId: 'source-b',
              output: 'ignored',
              artifacts: [{ artifactKind: 'text', sourcePortId: 'out-b', content: 'ignored branch' }],
            },
          ],
        }),
      }),
    });
    baselineModel.updateMany.mockResolvedValue(undefined);
    baselineModel.create.mockImplementation(async (payload) => payload);

    const result = await service.replaceBaselineFromExecution(playbookId, 'eval-1', executionId, new Types.ObjectId().toString());

    expect(result.inputSnapshots).toHaveLength(1);
    expect(result.inputSnapshots[0]).toMatchObject({
      sourceTaskId: 'source-a',
      sourceOutputPortId: 'out-a',
      targetInputPortId: 'in-a',
      output: 'kept',
    });
    expect(result.inputSnapshots[0].artifacts).toHaveLength(1);
  });

  it('requires matching evaluation execution for current baseline promotion', async () => {
    const playbookId = new Types.ObjectId().toString();
    const executionId = new Types.ObjectId().toString();
    evaluationExecutionModel.findById.mockReturnValue({
      lean: () => ({
        exec: async () => ({
          playbookId: new Types.ObjectId(playbookId),
          executionId: new Types.ObjectId(executionId),
          evaluationTaskId: 'eval-1',
        }),
      }),
    });

    await expect(service.replaceBaselineFromCurrentEvaluationExecution(
      playbookId,
      'eval-2',
      executionId,
      new Types.ObjectId().toString(),
      new Types.ObjectId().toString(),
    )).rejects.toThrow(BadRequestException);
  });

  it('persists evaluation execution from emitted artifact payload', async () => {
    const playbookId = new Types.ObjectId().toString();
    const executionId = new Types.ObjectId().toString();
    evaluationExecutionModel.create = jest.fn().mockImplementation(async (payload) => payload);

    const result = await service.persistEvaluationExecution({
      playbookId,
      executionId,
      task: {
        id: 'eval-1',
        title: 'Evaluation',
        evaluationConfig: {
          expectation: 'Check finance output',
          referenceBaselineId: null,
          passThreshold: 80,
          warningThreshold: 60,
          weight: 1,
          rubricVersion: 'evaluation-node-v1',
          weights: {},
        },
      },
      artifacts: [{
        artifactKind: 'data',
        data: {
          type: 'playbook_evaluation_result',
          mode: 'semantic',
          score: 84,
          verdict: 'pass',
          summary: 'Looks good',
          findings: [{ severity: 'info', category: 'semantic', message: 'ok' }],
        },
      }],
      durationMs: 1200,
      completedAt: new Date('2026-01-01T00:00:00.000Z'),
      modelName: 'judge-model',
    });

    expect(result).toMatchObject({
      evaluationTaskId: 'eval-1',
      mode: 'semantic',
      score: 84,
      verdict: 'pass',
      expectation: 'Check finance output',
      judgeModel: 'judge-model',
    });
  });
});
