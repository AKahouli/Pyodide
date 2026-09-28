import { PgFlowReadAdapter } from './pg-flow-read.adapter';

describe('PgFlowReadAdapter', () => {
  it('reads the owner reference and detaches a workspace through the flow repository', async () => {
    const flows = {
      findOwnerRef: jest.fn().mockResolvedValue({ id: 'flow-1', ownerId: 'user-1' }),
      removeWorkspaceReference: jest.fn().mockResolvedValue(2),
    };
    const adapter = new PgFlowReadAdapter(flows as any);

    await expect(adapter.findById('flow-1')).resolves.toEqual({ id: 'flow-1', ownerId: 'user-1' });
    await expect(adapter.removeWorkspaceReference('ws-1')).resolves.toBeUndefined();
    expect(flows.removeWorkspaceReference).toHaveBeenCalledWith('ws-1');
    flows.findOwnerRef.mockResolvedValueOnce(null);
    await expect(adapter.findById('missing')).resolves.toBeNull();
  });
});
