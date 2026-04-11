import { Types } from 'mongoose';
import { PlaybookJudgeEnrichmentService } from './playbook-judge-enrichment.service';

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
      playbookService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
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
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() } as any,
    );

    const normalized = (service as any).normalizeNodeJudgePayload({
      overallScore: '87',
      confidence: 82,
      toolUsageScore: 'bad',
      missingFacts: ['fact', 1, null],
      toolSelectionIssues: 'wrong-shape',
      safeAutoFixType: 'delete_everything',
      recommendation: 'generate_new_optimized_playbook',
      reason: '  Needs workflow cleanup  ',
    }, 'model-a');

    expect(normalized).toEqual(expect.objectContaining({
      overallScore: 87,
      confidence: 0.82,
      toolUsageScore: 0,
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
});
