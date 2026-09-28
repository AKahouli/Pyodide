import { PlaybookFlowHitlMemoryService } from './playbook-flow-hitl-memory.service';
import type { HitlMemoryRecord } from '../persistence/hitl-memory.repository';

const flowId = '6a272d051f4e6f361ed9846d';
const ownerId = '507f1f77bcf86cd799439011';

function memory(overrides: Partial<HitlMemoryRecord> = {}): HitlMemoryRecord {
  return {
    id: '6ab61962228a7b6acbe18189', ownerId, flowId, nodeId: null, memoryType: 'procedural', source: 'manual', title: 'T',
    content: 'C', normalizedInstruction: 'N', appliesTo: 'workflow', status: 'draft', sensitivity: 'normal',
    createdFromExecutionId: null, createdFromInterruptId: null,
    createdAt: new Date('2026-09-24T08:00:00.000Z'), updatedAt: new Date('2026-09-24T08:00:00.000Z'),
    ...overrides,
  };
}

describe('PlaybookFlowHitlMemoryService', () => {
  const setup = (flow: unknown = { id: flowId, ownerId }) => {
    const flows = { findOwnerRef: jest.fn().mockResolvedValue(flow) };
    const memories = {
      listForFlow: jest.fn().mockResolvedValue([memory()]),
      create: jest.fn().mockResolvedValue(memory()),
      update: jest.fn().mockResolvedValue(memory({ status: 'active' })),
      delete: jest.fn().mockResolvedValue(true),
    };
    return { service: new PlaybookFlowHitlMemoryService(flows as any, memories as any), flows, memories };
  };

  it('answers with the toJSON shape: id, no key for an origin that was never set', async () => {
    const { service, memories } = setup();

    const [listed] = await service.listMemories(flowId, ownerId);

    expect(memories.listForFlow).toHaveBeenCalledWith(flowId, ownerId);
    expect(listed).toMatchObject({ id: '6ab61962228a7b6acbe18189', flowId, ownerId, nodeId: null });
    expect(listed).not.toHaveProperty('_id');
    expect(listed).not.toHaveProperty('createdFromExecutionId');
  });

  it('creates a memory with the manual defaults', async () => {
    const { service, memories } = setup();

    await service.createMemory(flowId, ownerId, { title: 'T', content: 'C', normalizedInstruction: 'N', createdFromExecutionId: 'run-1' });

    expect(memories.create).toHaveBeenCalledWith({
      ownerId, flowId, nodeId: null, memoryType: 'procedural', source: 'manual', title: 'T', content: 'C', normalizedInstruction: 'N',
      appliesTo: 'workflow', status: 'draft', sensitivity: 'normal', createdFromExecutionId: 'run-1', createdFromInterruptId: undefined,
    });
  });

  it('updates and deletes only through the owned flow, and reports a missing memory', async () => {
    const { service, memories } = setup();

    expect(await service.updateMemory(flowId, ownerId, 'm1', { status: 'active' })).toMatchObject({ status: 'active' });
    expect(memories.update).toHaveBeenCalledWith('m1', flowId, ownerId, { status: 'active' });
    memories.update.mockResolvedValueOnce(null);
    await expect(service.updateMemory(flowId, ownerId, 'm1', {})).rejects.toMatchObject({ status: 404 });

    expect(await service.deleteMemory(flowId, ownerId, 'm1')).toEqual({ deleted: true });
    memories.delete.mockResolvedValueOnce(false);
    await expect(service.deleteMemory(flowId, ownerId, 'm1')).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a flow that is missing or owned by someone else', async () => {
    await expect(setup(null).service.listMemories(flowId, ownerId)).rejects.toMatchObject({ status: 404 });
    const { service, memories } = setup({ id: flowId, ownerId: '507f1f77bcf86cd799439012' });
    await expect(service.createMemory(flowId, ownerId, { title: 'T', content: 'C', normalizedInstruction: 'N' })).rejects.toMatchObject({ status: 404 });
    expect(memories.create).not.toHaveBeenCalled();
    // The owner id is compared in its canonical form.
    await expect(setup().service.listMemories(flowId, ownerId.toUpperCase())).resolves.toHaveLength(1);
  });
});
