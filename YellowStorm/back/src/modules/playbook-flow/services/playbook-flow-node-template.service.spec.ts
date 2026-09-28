import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PlaybookFlowNodeTemplateService } from './playbook-flow-node-template.service';
import type { NodeTemplateRecord } from '../persistence/node-template.repository';

const TEMPLATE_ID = '6a272d051f4e6f361ed9846d';

function makeRecord(overrides: Partial<NodeTemplateRecord> = {}): NodeTemplateRecord {
  return {
    id: TEMPLATE_ID,
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
    retryPolicy: null,
    modelId: null,
    enabled: true,
    version: 1,
    isBuiltIn: false,
    createdBy: null,
    updatedBy: null,
    createdAt: new Date('2026-05-16T00:00:00.000Z'),
    updatedAt: new Date('2026-05-16T00:00:00.000Z'),
    ...overrides,
  };
}

function makeRepository(overrides: Record<string, jest.Mock> = {}) {
  return {
    list: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(null),
    keyTaken: jest.fn().mockResolvedValue(false),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn().mockResolvedValue(true),
    replaceAll: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('PlaybookFlowNodeTemplateService', () => {
  const userId = '507f1f77bcf86cd799439011';

  it('includes router and human approval configs in responses, with ISO dates and no null description', async () => {
    const records = [
      makeRecord(),
      makeRecord({
        id: '6ab61962228a7b6acbe18189',
        key: 'approval-default',
        nodeType: 'human_approval',
        title: 'Approval',
        description: null,
        routerConfig: null,
        humanApprovalConfig: { promptTemplate: 'Review this output', timeoutSeconds: 900 },
      }),
    ];
    const repository = makeRepository({ list: jest.fn().mockResolvedValue(records) });

    const service = new PlaybookFlowNodeTemplateService(repository as any);
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
    expect(result.items[0]).toMatchObject({ id: TEMPLATE_ID, createdAt: '2026-05-16T00:00:00.000Z' });
    expect(result.items[1].humanApprovalConfig).toEqual({ promptTemplate: 'Review this output', timeoutSeconds: 900 });
    expect(result.items[1]).not.toHaveProperty('description', null);
    expect(repository.list).toHaveBeenCalledWith();

    // Served from the cache within its TTL.
    await service.findAll();
    expect(repository.list).toHaveBeenCalledTimes(1);
  });

  it('lists only the enabled templates for findEnabled', async () => {
    const repository = makeRepository({ list: jest.fn().mockResolvedValue([makeRecord()]) });
    const service = new PlaybookFlowNodeTemplateService(repository as any);

    expect((await service.findEnabled()).items).toHaveLength(1);
    expect(repository.list).toHaveBeenCalledWith({ enabledOnly: true });
  });

  it('persists router and human approval configs on create and update', async () => {
    const created = makeRecord({ humanApprovalConfig: { promptTemplate: 'Approve?', timeoutSeconds: 600 } });
    const updated = makeRecord({
      version: 2,
      routerConfig: null,
      nodeType: 'human_approval',
      humanApprovalConfig: { promptTemplate: 'Approve?', timeoutSeconds: 600 },
    });
    const repository = makeRepository({
      create: jest.fn().mockResolvedValue(created),
      findById: jest.fn().mockResolvedValue(makeRecord({ humanApprovalConfig: null })),
      update: jest.fn().mockResolvedValue(updated),
    });

    const service = new PlaybookFlowNodeTemplateService(repository as any);

    await service.create({
      key: ' approval-default ',
      nodeType: 'human_approval',
      title: 'Approval',
      category: 'analysis',
      inputPorts: [],
      outputPorts: [],
      routerConfig: null,
      humanApprovalConfig: { promptTemplate: 'Approve?', timeoutSeconds: 600 },
    }, userId);

    expect(repository.keyTaken).toHaveBeenCalledWith('approval-default');
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      key: 'approval-default',
      routerConfig: null,
      humanApprovalConfig: { promptTemplate: 'Approve?', timeoutSeconds: 600 },
      version: 1,
      isBuiltIn: false,
      createdBy: userId,
      updatedBy: userId,
    }));

    const response = await service.update(TEMPLATE_ID, {
      nodeType: 'human_approval',
      routerConfig: null,
      humanApprovalConfig: { promptTemplate: 'Approve?', timeoutSeconds: 600 },
    }, userId);

    expect(repository.update).toHaveBeenCalledWith(TEMPLATE_ID, {
      updatedBy: userId,
      nodeType: 'human_approval',
      routerConfig: null,
      humanApprovalConfig: { promptTemplate: 'Approve?', timeoutSeconds: 600 },
    });
    expect(response.version).toBe(2);
  });

  it('rejects duplicate template keys on create, also when a concurrent create wins the unique index', async () => {
    const service = new PlaybookFlowNodeTemplateService(makeRepository({ keyTaken: jest.fn().mockResolvedValue(true) }) as any);
    const dto = { key: 'approval-default', nodeType: 'human_approval' as const, title: 'Approval', category: 'analysis', inputPorts: [], outputPorts: [] };

    await expect(service.create(dto, userId)).rejects.toThrow('A template with this key already exists');

    const raced = new PlaybookFlowNodeTemplateService(makeRepository({
      create: jest.fn().mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'uq_playbook_node_templates_key' })),
    }) as any);
    await expect(raced.create(dto, userId)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a key taken by another template on update', async () => {
    const repository = makeRepository({
      findById: jest.fn().mockResolvedValue(makeRecord()),
      keyTaken: jest.fn().mockResolvedValue(true),
    });
    const service = new PlaybookFlowNodeTemplateService(repository as any);

    await expect(service.update(TEMPLATE_ID, { key: ' other ' }, userId)).rejects.toBeInstanceOf(ConflictException);
    expect(repository.keyTaken).toHaveBeenCalledWith('other', TEMPLATE_ID);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('answers a malformed id with 400 and a missing template with 404', async () => {
    const repository = makeRepository({ delete: jest.fn().mockResolvedValue(false) });
    const service = new PlaybookFlowNodeTemplateService(repository as any);

    expect(await service.findById('nope')).toBeNull();
    expect(repository.findById).not.toHaveBeenCalled();
    await expect(service.update('nope', {}, userId)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update(TEMPLATE_ID, {}, userId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.delete('nope')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.delete(TEMPLATE_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a value longer than its column instead of failing in the database', async () => {
    const repository = makeRepository({ findById: jest.fn().mockResolvedValue(makeRecord()) });
    const service = new PlaybookFlowNodeTemplateService(repository as any);

    await expect(service.update(TEMPLATE_ID, { title: 'x'.repeat(161) }, userId)).rejects.toThrow('title must be at most 160 characters');
    await expect(service.create({
      key: 'k', nodeType: 'agent', title: 't', category: 'c'.repeat(81), inputPorts: [], outputPorts: [],
    }, userId)).rejects.toThrow('category must be at most 80 characters');
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('replaces the catalogue by key and refuses empty or duplicate keys', async () => {
    const repository = makeRepository({ list: jest.fn().mockResolvedValue([makeRecord()]) });
    const service = new PlaybookFlowNodeTemplateService(repository as any);
    const item = { key: ' a ', nodeType: 'agent' as const, title: 'A', category: 'c', inputPorts: [{ id: 'in', name: 'In', artifactKind: 'text' }], outputPorts: [] };

    await expect(service.replaceAll({ version: 1, type: 'playbook-node-templates', items: [item, { ...item, key: 'a' }] }, userId))
      .rejects.toThrow('Import contains duplicate template keys');
    await expect(service.replaceAll({ version: 1, type: 'playbook-node-templates', items: [{ ...item, key: ' ' }] }, userId))
      .rejects.toThrow('Import contains an empty template key');

    const result = await service.replaceAll({ version: 1, type: 'playbook-node-templates', items: [item] }, userId);
    expect(repository.replaceAll).toHaveBeenCalledWith([expect.objectContaining({
      key: 'a', version: 1, isBuiltIn: false, enabled: true, createdBy: userId,
      inputPorts: [{ id: 'in', name: 'In', artifactKind: 'text', required: false }],
    })]);
    expect(result.items).toHaveLength(1);
  });
});
