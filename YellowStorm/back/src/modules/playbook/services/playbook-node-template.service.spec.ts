import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';

import { PlaybookNodeTemplateService } from './playbook-node-template.service';
import { PlaybookNodeTemplate } from '../schemas/playbook-node-template.schema';

describe('PlaybookNodeTemplateService', () => {
  let service: PlaybookNodeTemplateService;
  let model: {
    find: jest.Mock;
    findById: jest.Mock;
    findOne: jest.Mock;
    findByIdAndUpdate: jest.Mock;
    insertMany: jest.Mock;
    bulkWrite: jest.Mock;
  };

  beforeEach(async () => {
    model = {
      find: jest.fn(),
      findById: jest.fn(),
      findOne: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      insertMany: jest.fn(),
      bulkWrite: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybookNodeTemplateService,
        {
          provide: getModelToken(PlaybookNodeTemplate.name),
          useValue: model,
        },
      ],
    }).compile();

    service = module.get(PlaybookNodeTemplateService);
  });

  function mockFindOnce(result: unknown): void {
    const exec = jest.fn().mockResolvedValue(result);
    const lean = jest.fn().mockReturnValue({ exec });
    const select = jest.fn().mockReturnValue({ lean });
    model.find.mockReturnValueOnce({ select });
  }

  function mockFindAllOnce(result: unknown): void {
    const exec = jest.fn().mockResolvedValue(result);
    const sort = jest.fn().mockReturnValue({ exec });
    model.find.mockReturnValueOnce({ sort });
  }

  function buildExistingDefaults(overrides: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
    const defaults = [
      { _id: 'summarizer-id', key: 'summarizer', type: 'summarizer', isBuiltIn: true, enabled: true },
      { _id: 'docxgen-id', key: 'docxgen', type: 'docxgen', isBuiltIn: true, enabled: true },
      { _id: 'slidegen-id', key: 'slidegen', type: 'slidegen', isBuiltIn: true, enabled: true },
      { _id: 'codegen-id', key: 'codegen', type: 'codegen', isBuiltIn: true, enabled: true },
      { _id: 'analyzer-id', key: 'analyzer', type: 'analyzer', isBuiltIn: true, enabled: true },
      { _id: 'iterator-id', key: 'iterator', type: 'iterator', isBuiltIn: true, enabled: true },
    ];
    return [...defaults, ...overrides];
  }

  it('seeds and returns the evaluation built-in when missing', async () => {
    mockFindOnce([]);
    mockFindAllOnce([
      {
        _id: { toString: () => 'evaluation-id' },
        key: 'evaluation',
        type: 'evaluation',
        title: 'Evaluation Task',
        description: 'Evaluates connected outputs against expected results and optional reference baselines.',
        icon: 'Scale',
        color: 'rose',
        category: 'evaluation',
        inputPorts: [],
        outputPorts: [],
        promptTemplate: '',
        recommendedAgentTypeSlug: 'researcher',
        requiredToolNames: [],
        executionMode: 'agent',
        assignedAgentId: null,
        selectedAction: null,
        enabled: true,
        version: 1,
        isBuiltIn: true,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);

    const result = await service.findEnabled();

    expect(model.insertMany).toHaveBeenCalledTimes(1);
    expect(model.insertMany.mock.calls[0][0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'evaluation', type: 'evaluation', category: 'evaluation' })]),
    );
    expect(result.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'evaluation', type: 'evaluation', category: 'evaluation' })]),
    );
  });

  it('does not rewrite existing built-in templates during reads', async () => {
    mockFindOnce([
      ...buildExistingDefaults(),
      {
        _id: 'built-in-evaluation-id',
        key: 'evaluation',
        type: 'evaluation',
        isBuiltIn: true,
        enabled: false,
      },
    ]);
    mockFindAllOnce([]);

    await service.findEnabled();

    expect(model.insertMany).not.toHaveBeenCalled();
    expect(model.bulkWrite).not.toHaveBeenCalled();
  });

  it('does not insert a built-in when a custom template already uses the same type', async () => {
    mockFindOnce([
      ...buildExistingDefaults(),
      {
        _id: 'custom-evaluation-id',
        key: 'my-eval-template',
        type: 'evaluation',
        isBuiltIn: false,
        enabled: true,
      },
    ]);
    mockFindAllOnce([]);

    await service.findEnabled();

    expect(model.insertMany).not.toHaveBeenCalled();
    expect(model.bulkWrite).not.toHaveBeenCalled();
  });

  it('preserves built-in template edits after updating a built-in template', async () => {
    const builtInId = '507f1f77bcf86cd799439011';
    const userId = '507f191e810c19729de860ea';

    mockFindOnce([
      ...buildExistingDefaults(),
      {
        _id: builtInId,
        key: 'evaluation',
        type: 'evaluation',
        isBuiltIn: true,
        enabled: true,
      },
    ]);

    model.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: { toString: () => builtInId },
        key: 'evaluation',
        type: 'evaluation',
        title: 'Evaluation Task',
        description: 'Original built-in description',
        icon: 'Scale',
        color: 'rose',
        category: 'evaluation',
        inputPorts: [],
        outputPorts: [],
        promptTemplate: 'original prompt',
        recommendedAgentTypeSlug: 'researcher',
        requiredToolNames: [],
        executionMode: 'agent',
        assignedAgentId: null,
        selectedAction: null,
        enabled: true,
        version: 1,
        isBuiltIn: true,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    });

    model.findByIdAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: { toString: () => builtInId },
        key: 'evaluation',
        type: 'evaluation',
        title: 'Custom Evaluation Title',
        description: 'Custom saved description',
        icon: 'Scale',
        color: 'rose',
        category: 'evaluation',
        inputPorts: [],
        outputPorts: [],
        promptTemplate: 'custom saved prompt',
        recommendedAgentTypeSlug: 'researcher',
        requiredToolNames: [],
        executionMode: 'agent',
        assignedAgentId: null,
        selectedAction: null,
        enabled: true,
        version: 2,
        isBuiltIn: true,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      }),
    });

    const updated = await service.update(
      builtInId,
      {
        title: 'Custom Evaluation Title',
        description: 'Custom saved description',
        promptTemplate: 'custom saved prompt',
      },
      userId,
    );

    expect(updated.title).toBe('Custom Evaluation Title');
    expect(updated.description).toBe('Custom saved description');
    expect(updated.promptTemplate).toBe('custom saved prompt');

    mockFindOnce([
      ...buildExistingDefaults(),
      {
        _id: builtInId,
        key: 'evaluation',
        type: 'evaluation',
        isBuiltIn: true,
        enabled: true,
      },
    ]);
    mockFindAllOnce([]);

    await service.findAll();

    expect(model.bulkWrite).not.toHaveBeenCalled();
  });

  it('persists iteratorConfig on update responses', async () => {
    const templateId = '507f1f77bcf86cd799439012';
    const userId = '507f191e810c19729de860ea';
    const iteratorConfig = {
      source: '{{items}}',
      mode: 'batch' as const,
      batchSize: 25,
      itemVariable: 'row',
      outputVariable: 'rows',
      errorStrategy: 'continue' as const,
    };

    mockFindOnce(buildExistingDefaults());

    model.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: { toString: () => templateId },
        key: 'iterator',
        type: 'iterator',
        title: 'Iterator',
        description: 'Iterator template',
        icon: 'RefreshCw',
        color: 'cyan',
        category: 'analysis',
        inputPorts: [{ id: 'items', name: 'Items', artifactKind: 'data', required: false }],
        outputPorts: [{ id: 'results', name: 'Results', artifactKind: 'data' }],
        promptTemplate: '',
        recommendedAgentTypeSlug: null,
        requiredToolNames: [],
        executionMode: 'agent',
        assignedAgentId: null,
        selectedAction: null,
        iteratorConfig: null,
        enabled: true,
        version: 1,
        isBuiltIn: true,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    });

    model.findByIdAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: { toString: () => templateId },
        key: 'iterator',
        type: 'iterator',
        title: 'Iterator',
        description: 'Iterator template',
        icon: 'RefreshCw',
        color: 'cyan',
        category: 'analysis',
        inputPorts: [{ id: 'items', name: 'Items', artifactKind: 'data', required: false }],
        outputPorts: [{ id: 'results', name: 'Results', artifactKind: 'data' }],
        promptTemplate: '',
        recommendedAgentTypeSlug: null,
        requiredToolNames: [],
        executionMode: 'agent',
        assignedAgentId: null,
        selectedAction: null,
        iteratorConfig,
        enabled: true,
        version: 2,
        isBuiltIn: true,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      }),
    });

    const updated = await service.update(templateId, { iteratorConfig }, userId);

    expect(updated.iteratorConfig).toEqual(iteratorConfig);
    expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
      templateId,
      expect.objectContaining({
        $set: expect.objectContaining({ iteratorConfig }),
      }),
      { new: true },
    );
  });
});
