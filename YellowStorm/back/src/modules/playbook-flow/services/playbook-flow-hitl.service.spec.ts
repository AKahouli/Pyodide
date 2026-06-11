import { PlaybookFlowHitlBlockerService } from './playbook-flow-hitl-blocker.service';

const createFlowModel = (flow: { hitlBlockers?: unknown[]; save?: jest.Mock }) => ({
  findOne: jest.fn().mockResolvedValue(flow),
});

describe('PlaybookFlowHitlBlockerService', () => {
  it('lists only persisted blockers without seeding system defaults', async () => {
    const flow = {
      hitlBlockers: [{ id: 'user-blocker', createdBy: 'user' }],
      save: jest.fn().mockResolvedValue(undefined),
    };
    const flowModel = {
      findOne: jest.fn().mockResolvedValue(flow),
    };
    const service = new PlaybookFlowHitlBlockerService(flowModel as any);

    const blockers = await service.listBlockers('flow-1', 'user-1');

    expect(blockers).toEqual([{ id: 'user-blocker', createdBy: 'user' }]);
    expect(flow.save).not.toHaveBeenCalled();
  });

  it('returns an empty list when no blockers are stored', async () => {
    const flow = {
      hitlBlockers: [],
      save: jest.fn(),
    };
    const flowModel = {
      findOne: jest.fn().mockResolvedValue(flow),
    };
    const service = new PlaybookFlowHitlBlockerService(flowModel as any);

    await expect(service.listBlockers('flow-1', 'user-1')).resolves.toEqual([]);
    expect(flow.save).not.toHaveBeenCalled();
  });

  it('requires nodeId when creating node-scoped blockers', async () => {
    const flow = { hitlBlockers: [], save: jest.fn() };
    const service = new PlaybookFlowHitlBlockerService(createFlowModel(flow) as any);
    await expect(service.createBlocker('flow-1', 'user-1', {
      scope: 'node',
      kind: 'custom',
      label: 'Draft blocker',
      description: 'Ask me before continuing.',
      action: 'clarify',
    } as any)).rejects.toThrow('Node scope requires a nodeId.');
  });

  it('rejects workflow-scoped blockers with nodeId', async () => {
    const flow = { hitlBlockers: [], save: jest.fn() };
    const service = new PlaybookFlowHitlBlockerService(createFlowModel(flow) as any);
    await expect(service.createBlocker('flow-1', 'user-1', {
      scope: 'workflow',
      nodeId: 'step-1',
      kind: 'custom',
      label: 'Draft blocker',
      description: 'Ask me before continuing.',
      action: 'clarify',
    } as any)).rejects.toThrow('Workflow scope cannot include a nodeId.');
  });
});
