import { PlaybookFlowHitlBlockerService } from './playbook-flow-hitl-blocker.service';

const createFlows = (flow: { hitlBlockers?: unknown[] } | null) => ({
  findOwned: jest.fn().mockResolvedValue(flow ? { id: 'flow-1', ownerId: 'user-1', ...flow } : null),
  updateFields: jest.fn().mockResolvedValue({ id: 'flow-1' }),
});

describe('PlaybookFlowHitlBlockerService', () => {
  it('lists only persisted blockers without seeding system defaults', async () => {
    const flows = createFlows({ hitlBlockers: [{ id: 'user-blocker', createdBy: 'user' }] });
    const service = new PlaybookFlowHitlBlockerService(flows as any);

    const blockers = await service.listBlockers('flow-1', 'user-1');

    expect(blockers).toEqual([{ id: 'user-blocker', createdBy: 'user' }]);
    expect(flows.updateFields).not.toHaveBeenCalled();
  });

  it('returns an empty list when no blockers are stored', async () => {
    const flows = createFlows({ hitlBlockers: [] });
    const service = new PlaybookFlowHitlBlockerService(flows as any);

    await expect(service.listBlockers('flow-1', 'user-1')).resolves.toEqual([]);
    expect(flows.updateFields).not.toHaveBeenCalled();
  });

  it('requires nodeId when creating node-scoped blockers', async () => {
    const service = new PlaybookFlowHitlBlockerService(createFlows({ hitlBlockers: [] }) as any);
    await expect(service.createBlocker('flow-1', 'user-1', {
      scope: 'node',
      kind: 'custom',
      label: 'Draft blocker',
      description: 'Ask me before continuing.',
      action: 'clarify',
    } as any)).rejects.toThrow('Node scope requires a nodeId.');
  });

  it('rejects workflow-scoped blockers with nodeId', async () => {
    const service = new PlaybookFlowHitlBlockerService(createFlows({ hitlBlockers: [] }) as any);
    await expect(service.createBlocker('flow-1', 'user-1', {
      scope: 'workflow',
      nodeId: 'step-1',
      kind: 'custom',
      label: 'Draft blocker',
      description: 'Ask me before continuing.',
      action: 'clarify',
    } as any)).rejects.toThrow('Workflow scope cannot include a nodeId.');
  });

  it('appends a new user blocker and writes the whole list for the owner', async () => {
    const existing = { id: 'old', createdBy: 'user' };
    const flows = createFlows({ hitlBlockers: [existing] });
    const service = new PlaybookFlowHitlBlockerService(flows as any);

    const blocker = await service.createBlocker('flow-1', 'user-1', {
      kind: 'custom',
      label: 'Ask first',
      description: 'Ask me before continuing.',
      action: 'clarify',
    } as any);

    expect(blocker).toMatchObject({ scope: 'workflow', nodeId: null, enabled: true, riskLevel: 'medium', matcherType: 'llm_judge', createdBy: 'user' });
    expect(blocker.id).toMatch(/^[0-9a-f]{24}$/);
    expect(flows.updateFields).toHaveBeenCalledWith('flow-1', { hitlBlockers: [existing, blocker] }, { ownerId: 'user-1' });
  });

  it('updates and deletes a blocker by id, and reports an unknown one', async () => {
    const flows = createFlows({ hitlBlockers: [{ id: 'b1', enabled: true, label: 'x' }, { id: 'b2', enabled: true }] });
    const service = new PlaybookFlowHitlBlockerService(flows as any);

    await service.disableBlocker('flow-1', 'user-1', 'b1');
    expect(flows.updateFields.mock.calls[0][1].hitlBlockers[0]).toMatchObject({ id: 'b1', enabled: false, label: 'x' });

    await expect(service.deleteBlocker('flow-1', 'user-1', 'b2')).resolves.toEqual({ deleted: true });
    expect(flows.updateFields.mock.calls[1][1].hitlBlockers.map((b: { id: string }) => b.id)).toEqual(['b1']);

    await expect(service.deleteBlocker('flow-1', 'user-1', 'nope')).rejects.toThrow('HITL blocker not found');
    await expect(service.updateBlocker('flow-1', 'user-1', 'nope', { enabled: false } as any)).rejects.toThrow('HITL blocker not found');
  });

  it('reports a flow the user does not own as not found', async () => {
    const service = new PlaybookFlowHitlBlockerService(createFlows(null) as any);
    await expect(service.listBlockers('flow-1', 'user-1')).rejects.toThrow('Playbook not found');
  });
});
