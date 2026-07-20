import { NotFoundException } from '@modules/exceptions';
import { PlaybookAssistantContextService } from './playbook-assistant-context.service';

describe('PlaybookAssistantContextService', () => {
  const flow = {
    id: 'flow-1',
    ownerId: 'user-1',
    schemaVersion: 1,
    definitionRevision: 4,
    name: 'Invoice review',
    description: 'Review invoices',
    settings: { recursionLimit: 25, maxParallelism: 4 },
    nodes: [
      { id: 'task-1', kind: 'step', label: 'Load invoice' },
      { id: 'task-2', kind: 'step', label: 'Review invoice' },
    ],
    controlEdges: [{ id: 'edge-1', kind: 'sequential', source: 'task-1', target: 'task-2' }],
    dataBindings: [{ id: 'binding-1', sourceKind: 'node-output', sourceNode: 'task-1', sourcePort: 'output', targetNode: 'task-2', targetPort: 'input' }],
    workspaces: ['workspace-1'],
    triggerConfig: { kind: 'manual' },
    activeReplays: {},
    accessLevel: 'write',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const flowService = { findOne: jest.fn().mockResolvedValue(flow) };
  const validator = { collectValidationErrors: jest.fn().mockReturnValue([]) };
  const executionService = { findOne: jest.fn().mockResolvedValue({ id: 'execution-1', flowId: 'flow-1', status: 'pending_approval', pendingApproval: { interruptId: 'interrupt-1', nodeId: 'task-2' } }) };
  const service = new PlaybookAssistantContextService(flowService as never, validator as never, executionService as never);

  beforeEach(() => jest.clearAllMocks());

  it('returns canonical revision, selected task, dependencies, and status-only HITL context', async () => {
    const context = await service.open('flow-1', 'user-1', { selectedTaskId: 'task-2', executionId: 'execution-1' });

    expect(context).toMatchObject({
      playbookId: 'flow-1',
      definitionRevision: 4,
      access: { level: 'write', canUpdate: true },
      selectedTask: { id: 'task-2' },
      execution: {
        executionId: 'execution-1',
        waitingForHumanInput: true,
        currentInterruptId: 'interrupt-1',
        currentInterruptTaskId: 'task-2',
      },
    });
    expect(context.execution).not.toHaveProperty('pendingApproval');
    await expect(service.getDependencies('flow-1', 'user-1', 'task-2')).resolves.toMatchObject({
      upstreamTaskIds: ['task-1'],
      incomingBindings: [expect.objectContaining({ id: 'binding-1' })],
    });
  });

  it('rejects a selected task that is not in the canonical graph', async () => {
    await expect(service.open('flow-1', 'user-1', { selectedTaskId: 'missing' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
