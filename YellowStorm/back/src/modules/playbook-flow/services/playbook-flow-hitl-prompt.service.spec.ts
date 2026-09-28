import { PlaybookFlowHitlPromptService } from './playbook-flow-hitl-prompt.service';

describe('PlaybookFlowHitlPromptService', () => {
  const configService = { get: jest.fn().mockReturnValue(true) };
  const build = (flow: Record<string, unknown> | null) => {
    const flows = {
      findOwned: jest.fn().mockResolvedValue(flow ? { id: 'flow-1', ownerId: 'user-1', ...flow } : null),
      updateFields: jest.fn().mockResolvedValue({ id: 'flow-1' }),
      setNodeHitlPolicy: jest.fn().mockResolvedValue(true),
    };
    return { service: new PlaybookFlowHitlPromptService(flows as any, configService as any), flows };
  };

  it('returns the stored node mode instead of defaulting back to auto', async () => {
    const { service, flows } = build({ nodes: [{ id: 'node-1', hitlPolicy: { mode: 'off', sensitivity: 'balanced' } }] });

    await expect(service.getNodePolicy('flow-1', 'user-1', 'node-1')).resolves.toEqual(
      expect.objectContaining({ mode: 'off', inheritedFromWorkflow: true }),
    );
    expect(flows.findOwned).toHaveBeenCalledWith('flow-1', 'user-1');
  });

  it('writes only the node policy, in place and guarded on the node still being at its index', async () => {
    const { service, flows } = build({
      hitlPolicy: { mode: 'auto', sensitivity: 'balanced' },
      nodes: [{ id: 'node-0' }, { id: 'node-1', hitlPolicy: { mode: 'auto', sensitivity: 'balanced' } }],
    });

    await expect(service.updateNodePolicy('flow-1', 'user-1', 'node-1', { mode: 'off' } as any)).resolves.toEqual(
      expect.objectContaining({ mode: 'off' }),
    );
    expect(flows.setNodeHitlPolicy).toHaveBeenCalledWith('flow-1', 'user-1', 1, 'node-1', expect.objectContaining({ mode: 'off', sensitivity: 'balanced' }));
    expect(flows.updateFields).not.toHaveBeenCalled();

    flows.setNodeHitlPolicy.mockResolvedValueOnce(false);
    await expect(service.updateNodePolicy('flow-1', 'user-1', 'node-1', { mode: 'off' } as any)).rejects.toThrow('Playbook changed while updating the node policy');
  });

  it('merges the workflow policy over the defaults and writes it for the owner', async () => {
    const { service, flows } = build({ hitlPolicy: { sensitivity: 'strict' }, nodes: [] });

    const policy = await service.updatePolicy('flow-1', 'user-1', { reviewEnabled: true } as any);

    expect(policy).toMatchObject({ mode: 'auto', sensitivity: 'strict', reviewEnabled: true });
    expect(flows.updateFields).toHaveBeenCalledWith('flow-1', { hitlPolicy: policy }, { ownerId: 'user-1' });
  });

  it('reports a flow the user does not own, and an unknown node, as not found', async () => {
    await expect(build(null).service.getPolicy('flow-1', 'user-1')).rejects.toThrow('Playbook not found');
    await expect(build({ nodes: [] }).service.getNodePolicy('flow-1', 'user-1', 'missing')).rejects.toThrow('Playbook node not found');
  });
});
