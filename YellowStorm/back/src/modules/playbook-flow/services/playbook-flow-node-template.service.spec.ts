import { Types } from 'mongoose';
import { PlaybookFlowNodeTemplateService } from './playbook-flow-node-template.service';

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    key: 'router-default',
    nodeType: 'router',
    title: 'Router',
    description: 'Route work',
    icon: 'GitBranch',
    color: 'blue',
    category: 'analysis',
    inputPorts: [],
    outputPorts: [],
    promptTemplate: '',
    recommendedAgentTypeSlug: null,
    requiredToolNames: [],
    assignedAgentId: null,
    selectedAction: null,
    iteratorConfig: null,
    routerConfig: {
      outputLabels: ['retry', 'done', '__error__'],
      maxIterations: 3,
      defaultLabel: 'done',
      conditions: [{
        label: 'done',
        sourceNode: 'task-1',
        sourcePort: 'result',
        path: 'verdict',
        operator: 'equals',
        value: 'valid',
      }],
    },
    humanApprovalConfig: null,
    enabled: true,
    version: 1,
    isBuiltIn: false,
    createdAt: new Date('2026-05-16T00:00:00.000Z'),
    updatedAt: new Date('2026-05-16T00:00:00.000Z'),
    ...overrides,
  };
}

function execResult<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

describe('PlaybookFlowNodeTemplateService', () => {
  const userId = '507f1f77bcf86cd799439011';

  it('includes router and human approval configs in responses', async () => {
    const docs = [
      makeDoc(),
      makeDoc({
        _id: new Types.ObjectId(),
        key: 'approval-default',
        nodeType: 'human_approval',
        title: 'Approval',
        routerConfig: null,
        humanApprovalConfig: { promptTemplate: 'Review this output', timeoutSeconds: 900 },
      }),
    ];

    const model = {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue(execResult(docs)),
      }),
    } as any;

    const service = new PlaybookFlowNodeTemplateService(model);
    const result = await service.findAll();

    expect(result.items[0].routerConfig).toEqual({
      outputLabels: ['retry', 'done', '__error__'],
      maxIterations: 3,
      defaultLabel: 'done',
      conditions: [{
        label: 'done',
        sourceNode: 'task-1',
        sourcePort: 'result',
        path: 'verdict',
        operator: 'equals',
        value: 'valid',
      }],
    });
    expect(result.items[1].humanApprovalConfig).toEqual({ promptTemplate: 'Review this output', timeoutSeconds: 900 });
  });

  it('persists router and human approval configs on create and update', async () => {
    const createdDoc = makeDoc({ humanApprovalConfig: { promptTemplate: 'Approve?', timeoutSeconds: 600 } });
    const existingDoc = makeDoc({ _id: createdDoc._id, version: 1, humanApprovalConfig: null });
    const updatedDoc = makeDoc({
      _id: createdDoc._id,
      version: 2,
      routerConfig: null,
      nodeType: 'human_approval',
      humanApprovalConfig: { promptTemplate: 'Approve?', timeoutSeconds: 600 },
    });

    const findOne = jest.fn().mockReturnValue(execResult(null));
    const create = jest.fn().mockResolvedValue(createdDoc);
    const findById = jest.fn().mockReturnValueOnce(execResult(existingDoc));
    const findByIdAndUpdate = jest.fn().mockReturnValue(execResult(updatedDoc));

    const model = {
      findOne,
      create,
      findById,
      findByIdAndUpdate,
    } as any;

    const service = new PlaybookFlowNodeTemplateService(model);

    await service.create({
      key: 'approval-default',
      nodeType: 'human_approval',
      title: 'Approval',
      category: 'analysis',
      inputPorts: [],
      outputPorts: [],
      routerConfig: null,
      humanApprovalConfig: { promptTemplate: 'Approve?', timeoutSeconds: 600 },
    }, userId);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      routerConfig: null,
      humanApprovalConfig: { promptTemplate: 'Approve?', timeoutSeconds: 600 },
    }));

    await service.update(String(createdDoc._id), {
      nodeType: 'human_approval',
      routerConfig: null,
      humanApprovalConfig: { promptTemplate: 'Approve?', timeoutSeconds: 600 },
    }, userId);

    expect(findByIdAndUpdate).toHaveBeenCalledWith(
      String(createdDoc._id),
      {
        $set: expect.objectContaining({
          routerConfig: null,
          humanApprovalConfig: { promptTemplate: 'Approve?', timeoutSeconds: 600 },
        }),
      },
      { new: true },
    );
  });

  it('rejects duplicate template keys on create', async () => {
    const existingDoc = makeDoc({ key: 'approval-default' });
    const model = {
      findOne: jest.fn().mockReturnValue(execResult(existingDoc)),
    } as any;

    const service = new PlaybookFlowNodeTemplateService(model);

    await expect(service.create({
      key: 'approval-default',
      nodeType: 'human_approval',
      title: 'Approval',
      category: 'analysis',
      inputPorts: [],
      outputPorts: [],
    }, userId)).rejects.toThrow('A template with this key already exists');
  });
});
