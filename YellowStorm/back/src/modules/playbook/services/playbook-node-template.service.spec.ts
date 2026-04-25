import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';

import { PlaybookNodeTemplateService } from './playbook-node-template.service';
import { PlaybookNodeTemplate } from '../schemas/playbook-node-template.schema';

describe('PlaybookNodeTemplateService', () => {
  let service: PlaybookNodeTemplateService;
  let model: {
    find: jest.Mock;
    insertMany: jest.Mock;
    bulkWrite: jest.Mock;
  };

  beforeEach(async () => {
    model = {
      find: jest.fn(),
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

  it('refreshes built-in template fields without forcing enabled back on', async () => {
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
    expect(model.bulkWrite).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          updateOne: expect.objectContaining({
            filter: { _id: 'built-in-evaluation-id' },
            update: expect.objectContaining({
              $set: expect.objectContaining({
                key: 'evaluation',
                type: 'evaluation',
                category: 'evaluation',
                isBuiltIn: true,
              }),
            }),
          }),
        }),
      ]),
      { ordered: false },
    );
    const bulkPayload = model.bulkWrite.mock.calls[0][0];
    expect(bulkPayload[0].updateOne.update.$set.enabled).toBeUndefined();
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
    expect(model.bulkWrite).toHaveBeenCalledTimes(1);
    const bulkPayload = model.bulkWrite.mock.calls[0][0];
    expect(bulkPayload).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          updateOne: expect.objectContaining({
            filter: { _id: 'custom-evaluation-id' },
          }),
        }),
      ]),
    );
  });
});
