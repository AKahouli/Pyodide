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
});
