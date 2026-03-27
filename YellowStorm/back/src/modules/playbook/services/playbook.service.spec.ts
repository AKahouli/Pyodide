import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { PlaybookService } from './playbook.service';
import { Playbook } from '../schemas/playbook.schema';
import { ExecutionStatus, PlaybookExecution } from '../schemas/playbook-execution.schema';
import { PlaybookDesignMessage } from '../schemas/playbook-design-message.schema';
import { LoggerService } from '../../logger';
import { NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { PlaybookReplayService } from './playbook-replay.service';
import { PlaybookOutputFormatService } from './playbook-output-format.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const objectId = (id?: string) => new Types.ObjectId(id);
const toStringId = (oid: Types.ObjectId) => oid.toHexString();

const MOCK_USER_ID = new Types.ObjectId().toHexString();
const MOCK_PLAYBOOK_ID = new Types.ObjectId().toHexString();
const MOCK_EXECUTION_ID = new Types.ObjectId().toHexString();
const MOCK_MESSAGE_ID = new Types.ObjectId().toHexString();
const MOCK_WORKSPACE_ID = new Types.ObjectId().toHexString();

const now = new Date();

function makeMockTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    title: 'Task 1',
    description: 'Do something',
    assignedAgentId: new Types.ObjectId(),
    executionOrder: 1,
    positionX: 100,
    positionY: 200,
    interruptBefore: false,
    interruptAfter: false,
    allowClarification: false,
    clarificationPrompt: '',
    maxClarifications: 3,
    inputKeys: ['input1'],
    outputKey: 'output1',
    notifyOnComplete: false,
    notifyEmails: [],
    ...overrides,
  };
}

function makeMockEdge(overrides: Record<string, unknown> = {}) {
  return {
    id: 'edge-1',
    sourceId: 'task-1',
    targetId: 'task-2',
    ...overrides,
  };
}

function makeMockPlaybook(overrides: Record<string, unknown> = {}) {
  return {
    _id: objectId(MOCK_PLAYBOOK_ID),
    name: 'Test Playbook',
    description: 'A test playbook',
    tasks: [makeMockTask()],
    edges: [makeMockEdge()],
    workspaces: [objectId(MOCK_WORKSPACE_ID)],
    createdBy: objectId(MOCK_USER_ID),
    isFavorite: false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeMockExecution(overrides: Record<string, unknown> = {}) {
  return {
    _id: objectId(MOCK_EXECUTION_ID),
    playbookId: objectId(MOCK_PLAYBOOK_ID),
    executedBy: objectId(MOCK_USER_ID),
    executionNumber: 1,
    status: 'completed',
    taskResults: [
      {
        taskId: 'task-1',
        nodeTitle: 'Task 1',
        agentName: 'Agent A',
        order: 1,
        status: 'completed',
        output: 'Done',
        error: null,
        durationMs: 1234,
        startedAt: now,
        completedAt: now,
        components: [],
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        modelName: 'gpt-4',
      },
    ],
    threadId: 'thread-abc',
    interruptPayload: null,
    error: null,
    durationMs: 5000,
    startedAt: now,
    completedAt: now,
    singleStepTaskId: null,
    playbookSnapshot: { name: 'snap' },
    totalInputTokens: 10,
    totalOutputTokens: 20,
    totalTokens: 30,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeMockDesignMessage(overrides: Record<string, unknown> = {}) {
  return {
    _id: objectId(MOCK_MESSAGE_ID),
    playbookId: objectId(MOCK_PLAYBOOK_ID),
    createdBy: objectId(MOCK_USER_ID),
    userQuery: 'Add a new task',
    aiSummary: 'Added task-2',
    snapshotBefore: { tasks: [makeMockTask()], edges: [makeMockEdge()] },
    status: 'completed',
    revertedFromMessageId: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Chain builder – returns a mock that chains .select/.lean/.sort/.skip/.limit/.populate/.exec
// ---------------------------------------------------------------------------
function createQueryChain(resolvedValue: unknown) {
  const chain: Record<string, jest.Mock> = {};
  const methods = ['select', 'lean', 'sort', 'skip', 'limit', 'populate'];
  methods.forEach((m) => {
    chain[m] = jest.fn().mockReturnValue(chain);
  });
  chain.exec = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('PlaybookService', () => {
  let service: PlaybookService;
  let playbookModel: Record<string, jest.Mock>;
  let executionModel: Record<string, jest.Mock>;
  let designMessageModel: Record<string, jest.Mock>;
  let loggerService: Record<string, jest.Mock>;
  let replayService: Record<string, jest.Mock>;
  let outputFormatService: Record<string, jest.Mock>;

  beforeEach(async () => {
    playbookModel = {
      create: jest.fn(),
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      findOne: jest.fn(),
      aggregate: jest.fn(),
      updateMany: jest.fn(),
    };

    executionModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      countDocuments: jest.fn(),
      insertMany: jest.fn(),
    };

    designMessageModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
    };

    loggerService = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    replayService = {
      getActiveReplays: jest.fn().mockResolvedValue(new Map()),
    };

    outputFormatService = {
      getActiveTemplates: jest.fn().mockResolvedValue(new Map()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybookService,
        { provide: getModelToken(Playbook.name), useValue: playbookModel },
        { provide: getModelToken(PlaybookExecution.name), useValue: executionModel },
        { provide: getModelToken(PlaybookDesignMessage.name), useValue: designMessageModel },
        { provide: LoggerService, useValue: loggerService },
        { provide: PlaybookReplayService, useValue: replayService },
        { provide: PlaybookOutputFormatService, useValue: outputFormatService },
      ],
    }).compile();

    service = module.get<PlaybookService>(PlaybookService);
  });

  // -------------------------------------------------------------------------
  // constructor
  // -------------------------------------------------------------------------
  describe('constructor', () => {
    it('should set logger context to PlaybookService', () => {
      expect(loggerService.setContext).toHaveBeenCalledWith('PlaybookService');
    });
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------
  describe('create', () => {
    it('should create a playbook with correct fields and return mapped response', async () => {
      const dto = { name: 'New Playbook', description: 'Desc', workspaces: [MOCK_WORKSPACE_ID] };
      const mockDoc = makeMockPlaybook({
        name: dto.name,
        description: dto.description,
        tasks: [],
        edges: [],
      });
      playbookModel.create.mockResolvedValue(mockDoc);

      const result = await service.create(MOCK_USER_ID, dto);

      expect(playbookModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Playbook',
          description: 'Desc',
          tasks: [],
          edges: [],
          isActive: true,
        }),
      );
      // createdBy should be an ObjectId
      const callArg = playbookModel.create.mock.calls[0][0];
      expect(callArg.createdBy).toBeInstanceOf(Types.ObjectId);
      expect(callArg.createdBy.toHexString()).toBe(MOCK_USER_ID);
      // workspaces mapped to ObjectIds
      expect(callArg.workspaces[0]).toBeInstanceOf(Types.ObjectId);

      expect(result.id).toBe(MOCK_PLAYBOOK_ID);
      expect(result.name).toBe('New Playbook');
      expect(loggerService.log).toHaveBeenCalledWith(
        'Playbook created',
        expect.objectContaining({ userId: MOCK_USER_ID }),
      );
    });

    it('should default description to empty string when not provided', async () => {
      const dto = { name: 'No Desc' };
      playbookModel.create.mockResolvedValue(makeMockPlaybook({ name: 'No Desc', description: '' }));

      await service.create(MOCK_USER_ID, dto);

      expect(playbookModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: '' }),
      );
    });

    it('should default workspaces to empty array when not provided', async () => {
      const dto = { name: 'No WS' };
      playbookModel.create.mockResolvedValue(makeMockPlaybook({ name: 'No WS', workspaces: [] }));

      await service.create(MOCK_USER_ID, dto);

      expect(playbookModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ workspaces: [] }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // createWithTasksAndEdges
  // -------------------------------------------------------------------------
  describe('createWithTasksAndEdges', () => {
    it('should create a playbook with provided tasks and edges', async () => {
      const tasks = [makeMockTask(), makeMockTask({ id: 'task-2', title: 'Task 2' })];
      const edges = [makeMockEdge()];
      const mockDoc = makeMockPlaybook({ tasks, edges });
      playbookModel.create.mockResolvedValue(mockDoc);

      const result = await service.createWithTasksAndEdges(
        MOCK_USER_ID,
        'With Tasks',
        'Desc',
        tasks,
        edges,
        [MOCK_WORKSPACE_ID],
      );

      expect(playbookModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'With Tasks',
          description: 'Desc',
          tasks,
          edges,
          isActive: true,
        }),
      );
      expect(result.tasks).toHaveLength(2);
      expect(loggerService.log).toHaveBeenCalledWith(
        'Playbook created with tasks',
        expect.objectContaining({ taskCount: 2, edgeCount: 1 }),
      );
    });

    it('should default description to empty string when falsy', async () => {
      playbookModel.create.mockResolvedValue(makeMockPlaybook({ description: '' }));

      await service.createWithTasksAndEdges(MOCK_USER_ID, 'X', '', [], [], []);

      expect(playbookModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: '' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // findById
  // -------------------------------------------------------------------------
  describe('findById', () => {
    it('should return mapped playbook response', async () => {
      const mockDoc = makeMockPlaybook();
      const chain = createQueryChain(mockDoc);
      playbookModel.findById.mockReturnValue(chain);

      const result = await service.findById(MOCK_PLAYBOOK_ID);

      expect(playbookModel.findById).toHaveBeenCalledWith(MOCK_PLAYBOOK_ID);
      expect(chain.lean).toHaveBeenCalled();
      expect(chain.exec).toHaveBeenCalled();
      expect(result.id).toBe(MOCK_PLAYBOOK_ID);
      expect(result.name).toBe('Test Playbook');
      expect(result.tasks).toHaveLength(1);
      expect(result.edges).toHaveLength(1);
      expect(result.workspaces).toEqual([MOCK_WORKSPACE_ID]);
      expect(result.createdBy).toBe(MOCK_USER_ID);
    });

    it('should throw NotFoundException for non-existent playbook', async () => {
      const chain = createQueryChain(null);
      playbookModel.findById.mockReturnValue(chain);

      await expect(service.findById(MOCK_PLAYBOOK_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // findAllByUser
  // -------------------------------------------------------------------------
  describe('findAllByUser', () => {
    const summaryDoc = {
      _id: objectId(MOCK_PLAYBOOK_ID),
      name: 'PB',
      description: 'desc',
      taskCount: 2,
      isFavorite: false,
      lastExecutionAt: null,
      createdAt: now,
      updatedAt: now,
    };

    it('should return paginated results with default params', async () => {
      playbookModel.aggregate.mockResolvedValue([
        { metadata: [{ total: 1 }], data: [summaryDoc] },
      ]);

      const result = await service.findAllByUser(MOCK_USER_ID, {});

      expect(playbookModel.aggregate).toHaveBeenCalled();
      expect(result.playbooks).toHaveLength(1);
      expect(result.playbooks[0].id).toBe(MOCK_PLAYBOOK_ID);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
    });

    it('should handle empty results (no metadata)', async () => {
      playbookModel.aggregate.mockResolvedValue([{ metadata: [], data: [] }]);

      const result = await service.findAllByUser(MOCK_USER_ID, {});

      expect(result.playbooks).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.totalPages).toBe(0);
    });

    it('should apply search filter as regex', async () => {
      playbookModel.aggregate.mockResolvedValue([{ metadata: [], data: [] }]);

      await service.findAllByUser(MOCK_USER_ID, { search: 'test' });

      const pipeline = playbookModel.aggregate.mock.calls[0][0];
      const matchStage = pipeline[0].$match;
      expect(matchStage.name).toEqual({ $regex: 'test', $options: 'i' });
    });

    it('should escape special regex characters in search', async () => {
      playbookModel.aggregate.mockResolvedValue([{ metadata: [], data: [] }]);

      await service.findAllByUser(MOCK_USER_ID, { search: 'test.+' });

      const pipeline = playbookModel.aggregate.mock.calls[0][0];
      const matchStage = pipeline[0].$match;
      // escapeRegex should escape the special chars
      expect(matchStage.name.$regex).toBe('test\\.\\+');
    });

    it('should apply date range filters on native fields', async () => {
      playbookModel.aggregate.mockResolvedValue([{ metadata: [], data: [] }]);
      const dateFrom = '2025-01-01T00:00:00.000Z';
      const dateTo = '2025-12-31T23:59:59.000Z';

      await service.findAllByUser(MOCK_USER_ID, {
        dateField: 'createdAt',
        dateFrom,
        dateTo,
      });

      const pipeline = playbookModel.aggregate.mock.calls[0][0];
      const matchStage = pipeline[0].$match;
      expect(matchStage.createdAt).toBeDefined();
      expect(matchStage.createdAt.$gte).toEqual(new Date(dateFrom));
      expect(matchStage.createdAt.$lte).toEqual(new Date(dateTo));
    });

    it('should apply only dateFrom when dateTo is absent', async () => {
      playbookModel.aggregate.mockResolvedValue([{ metadata: [], data: [] }]);

      await service.findAllByUser(MOCK_USER_ID, {
        dateField: 'updatedAt',
        dateFrom: '2025-06-01T00:00:00.000Z',
      });

      const pipeline = playbookModel.aggregate.mock.calls[0][0];
      const matchStage = pipeline[0].$match;
      expect(matchStage.updatedAt.$gte).toBeDefined();
      expect(matchStage.updatedAt.$lte).toBeUndefined();
    });

    it('should apply minTasks filter', async () => {
      playbookModel.aggregate.mockResolvedValue([{ metadata: [], data: [] }]);

      await service.findAllByUser(MOCK_USER_ID, { minTasks: 3 });

      const pipeline = playbookModel.aggregate.mock.calls[0][0];
      // After $addFields { taskCount }, there should be a $match { taskCount: { $gte: 3 } }
      const taskMatchStage = pipeline.find(
        (s: any) => s.$match && s.$match.taskCount !== undefined,
      );
      expect(taskMatchStage).toBeDefined();
      expect(taskMatchStage.$match.taskCount.$gte).toBe(3);
    });

    it('should apply maxTasks filter', async () => {
      playbookModel.aggregate.mockResolvedValue([{ metadata: [], data: [] }]);

      await service.findAllByUser(MOCK_USER_ID, { maxTasks: 10 });

      const pipeline = playbookModel.aggregate.mock.calls[0][0];
      const taskMatchStage = pipeline.find(
        (s: any) => s.$match && s.$match.taskCount !== undefined,
      );
      expect(taskMatchStage).toBeDefined();
      expect(taskMatchStage.$match.taskCount.$lte).toBe(10);
    });

    it('should apply both minTasks and maxTasks filters', async () => {
      playbookModel.aggregate.mockResolvedValue([{ metadata: [], data: [] }]);

      await service.findAllByUser(MOCK_USER_ID, { minTasks: 2, maxTasks: 5 });

      const pipeline = playbookModel.aggregate.mock.calls[0][0];
      const taskMatchStage = pipeline.find(
        (s: any) => s.$match && s.$match.taskCount !== undefined,
      );
      expect(taskMatchStage.$match.taskCount).toEqual({ $gte: 2, $lte: 5 });
    });

    it('should add execution lookup when sortBy is lastExecutionAt', async () => {
      playbookModel.aggregate.mockResolvedValue([{ metadata: [], data: [] }]);

      await service.findAllByUser(MOCK_USER_ID, { sortBy: 'lastExecutionAt' });

      const pipeline = playbookModel.aggregate.mock.calls[0][0];
      const lookupStage = pipeline.find((s: any) => s.$lookup);
      expect(lookupStage).toBeDefined();
      expect(lookupStage.$lookup.from).toBe('playbook_executions');
    });

    it('should add execution lookup when dateField is lastExecutionAt', async () => {
      playbookModel.aggregate.mockResolvedValue([{ metadata: [], data: [] }]);

      await service.findAllByUser(MOCK_USER_ID, {
        dateField: 'lastExecutionAt',
        dateFrom: '2025-01-01T00:00:00.000Z',
      });

      const pipeline = playbookModel.aggregate.mock.calls[0][0];
      const lookupStage = pipeline.find((s: any) => s.$lookup);
      expect(lookupStage).toBeDefined();
      // Should also add a $match on lastExecutionAt
      const lastExecMatch = pipeline.find(
        (s: any) => s.$match && s.$match.lastExecutionAt !== undefined,
      );
      expect(lastExecMatch).toBeDefined();
    });

    it('should not add execution lookup for default sort', async () => {
      playbookModel.aggregate.mockResolvedValue([{ metadata: [], data: [] }]);

      await service.findAllByUser(MOCK_USER_ID, {});

      const pipeline = playbookModel.aggregate.mock.calls[0][0];
      const lookupStage = pipeline.find((s: any) => s.$lookup);
      expect(lookupStage).toBeUndefined();
    });

    it('should respect custom page and limit', async () => {
      playbookModel.aggregate.mockResolvedValue([
        { metadata: [{ total: 50 }], data: [] },
      ]);

      const result = await service.findAllByUser(MOCK_USER_ID, { page: 3, limit: 10 });

      expect(result.pagination.page).toBe(3);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.totalPages).toBe(5);

      // Check $skip = (3-1)*10 = 20 in the facet data pipeline
      const pipeline = playbookModel.aggregate.mock.calls[0][0];
      const facetStage = pipeline.find((s: any) => s.$facet);
      const skipStage = facetStage.$facet.data.find((s: any) => s.$skip !== undefined);
      expect(skipStage.$skip).toBe(20);
      const limitStage = facetStage.$facet.data.find((s: any) => s.$limit !== undefined);
      expect(limitStage.$limit).toBe(10);
    });

    it('should sort favorites first then by sortBy/sortOrder', async () => {
      playbookModel.aggregate.mockResolvedValue([{ metadata: [], data: [] }]);

      await service.findAllByUser(MOCK_USER_ID, { sortBy: 'name', sortOrder: 'asc' });

      const pipeline = playbookModel.aggregate.mock.calls[0][0];
      const facetStage = pipeline.find((s: any) => s.$facet);
      const sortStage = facetStage.$facet.data.find((s: any) => s.$sort);
      expect(sortStage.$sort.isFavorite).toBe(-1);
      expect(sortStage.$sort.name).toBe(1);
    });

    it('should sort desc when sortOrder is desc', async () => {
      playbookModel.aggregate.mockResolvedValue([{ metadata: [], data: [] }]);

      await service.findAllByUser(MOCK_USER_ID, { sortBy: 'updatedAt', sortOrder: 'desc' });

      const pipeline = playbookModel.aggregate.mock.calls[0][0];
      const facetStage = pipeline.find((s: any) => s.$facet);
      const sortStage = facetStage.$facet.data.find((s: any) => s.$sort);
      expect(sortStage.$sort.updatedAt).toBe(-1);
    });

    it('should not apply date filter when dateField is invalid', async () => {
      playbookModel.aggregate.mockResolvedValue([{ metadata: [], data: [] }]);

      await service.findAllByUser(MOCK_USER_ID, {
        dateField: 'updatedAt',
        // no dateFrom or dateTo => dateRange is empty, no filter applied
      });

      const pipeline = playbookModel.aggregate.mock.calls[0][0];
      const matchStage = pipeline[0].$match;
      expect(matchStage.updatedAt).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------
  describe('update', () => {
    it('should update playbook fields and return mapped response', async () => {
      const updated = makeMockPlaybook({ name: 'Updated' });
      const chain = createQueryChain(updated);
      playbookModel.findByIdAndUpdate.mockReturnValue(chain);

      const result = await service.update(MOCK_PLAYBOOK_ID, { name: 'Updated' });

      expect(playbookModel.findByIdAndUpdate).toHaveBeenCalledWith(
        MOCK_PLAYBOOK_ID,
        { $set: { name: 'Updated' } },
        { new: true },
      );
      expect(result.name).toBe('Updated');
    });

    it('should only include defined fields in update data', async () => {
      const chain = createQueryChain(makeMockPlaybook());
      playbookModel.findByIdAndUpdate.mockReturnValue(chain);

      await service.update(MOCK_PLAYBOOK_ID, { name: 'Only Name' });

      const setArg = playbookModel.findByIdAndUpdate.mock.calls[0][1].$set;
      expect(setArg).toEqual({ name: 'Only Name' });
      expect(setArg.description).toBeUndefined();
      expect(setArg.tasks).toBeUndefined();
    });

    it('should map workspace strings to ObjectIds', async () => {
      const wsId = new Types.ObjectId().toHexString();
      const chain = createQueryChain(makeMockPlaybook());
      playbookModel.findByIdAndUpdate.mockReturnValue(chain);

      await service.update(MOCK_PLAYBOOK_ID, { workspaces: [wsId] });

      const setArg = playbookModel.findByIdAndUpdate.mock.calls[0][1].$set;
      expect(setArg.workspaces[0]).toBeInstanceOf(Types.ObjectId);
      expect(setArg.workspaces[0].toHexString()).toBe(wsId);
    });

    it('should include tasks and edges when provided', async () => {
      const tasks = [{ id: 't1', title: 'T1' }] as any[];
      const edges = [{ id: 'e1', sourceId: 't1', targetId: 't2' }] as any[];
      const chain = createQueryChain(makeMockPlaybook({ tasks, edges }));
      playbookModel.findByIdAndUpdate.mockReturnValue(chain);

      await service.update(MOCK_PLAYBOOK_ID, { tasks, edges } as any);

      const setArg = playbookModel.findByIdAndUpdate.mock.calls[0][1].$set;
      expect(setArg.tasks).toBe(tasks);
      expect(setArg.edges).toBe(edges);
    });

    it('should throw NotFoundException for non-existent playbook', async () => {
      const chain = createQueryChain(null);
      playbookModel.findByIdAndUpdate.mockReturnValue(chain);

      await expect(service.update(MOCK_PLAYBOOK_ID, { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------
  describe('delete', () => {
    it('should soft delete by setting isActive to false', async () => {
      const chain = createQueryChain(makeMockPlaybook());
      playbookModel.findByIdAndUpdate.mockReturnValue(chain);

      await service.delete(MOCK_PLAYBOOK_ID);

      expect(playbookModel.findByIdAndUpdate).toHaveBeenCalledWith(
        MOCK_PLAYBOOK_ID,
        { $set: { isActive: false } },
      );
      expect(loggerService.log).toHaveBeenCalledWith(
        'Playbook soft deleted',
        { playbookId: MOCK_PLAYBOOK_ID },
      );
    });

    it('should throw NotFoundException for non-existent playbook', async () => {
      const chain = createQueryChain(null);
      playbookModel.findByIdAndUpdate.mockReturnValue(chain);

      await expect(service.delete(MOCK_PLAYBOOK_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // bulkDelete
  // -------------------------------------------------------------------------
  describe('bulkDelete', () => {
    it('should soft delete multiple playbooks and return count', async () => {
      playbookModel.updateMany.mockResolvedValue({ modifiedCount: 3 });

      const ids = [
        new Types.ObjectId().toHexString(),
        new Types.ObjectId().toHexString(),
        new Types.ObjectId().toHexString(),
      ];
      const result = await service.bulkDelete(MOCK_USER_ID, ids);

      expect(playbookModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: { $in: expect.any(Array) },
          createdBy: expect.any(Types.ObjectId),
          isActive: true,
        }),
        { $set: { isActive: false } },
      );
      expect(result.deleted).toBe(3);
      expect(loggerService.log).toHaveBeenCalledWith(
        'Playbooks bulk soft deleted',
        expect.objectContaining({ count: 3 }),
      );
    });

    it('should convert string ids to ObjectIds', async () => {
      playbookModel.updateMany.mockResolvedValue({ modifiedCount: 0 });
      const id1 = new Types.ObjectId().toHexString();

      await service.bulkDelete(MOCK_USER_ID, [id1]);

      const filter = playbookModel.updateMany.mock.calls[0][0];
      expect(filter._id.$in[0]).toBeInstanceOf(Types.ObjectId);
      expect(filter._id.$in[0].toHexString()).toBe(id1);
      expect(filter.createdBy.toHexString()).toBe(MOCK_USER_ID);
    });

    it('should return zero deleted when no matches', async () => {
      playbookModel.updateMany.mockResolvedValue({ modifiedCount: 0 });

      const result = await service.bulkDelete(MOCK_USER_ID, [new Types.ObjectId().toHexString()]);

      expect(result.deleted).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // toggleFavorite
  // -------------------------------------------------------------------------
  describe('toggleFavorite', () => {
    it('should toggle isFavorite from false to true', async () => {
      const chain = createQueryChain(makeMockPlaybook({ isFavorite: false }));
      playbookModel.findById.mockReturnValue(chain);
      playbookModel.findByIdAndUpdate.mockResolvedValue(null);

      const result = await service.toggleFavorite(MOCK_PLAYBOOK_ID);

      expect(result.isFavorite).toBe(true);
      expect(playbookModel.findByIdAndUpdate).toHaveBeenCalledWith(MOCK_PLAYBOOK_ID, {
        $set: { isFavorite: true },
      });
    });

    it('should toggle isFavorite from true to false', async () => {
      const chain = createQueryChain(makeMockPlaybook({ isFavorite: true }));
      playbookModel.findById.mockReturnValue(chain);
      playbookModel.findByIdAndUpdate.mockResolvedValue(null);

      const result = await service.toggleFavorite(MOCK_PLAYBOOK_ID);

      expect(result.isFavorite).toBe(false);
      expect(playbookModel.findByIdAndUpdate).toHaveBeenCalledWith(MOCK_PLAYBOOK_ID, {
        $set: { isFavorite: false },
      });
    });

    it('should throw NotFoundException for non-existent playbook', async () => {
      const chain = createQueryChain(null);
      playbookModel.findById.mockReturnValue(chain);

      await expect(service.toggleFavorite(MOCK_PLAYBOOK_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // findRawById
  // -------------------------------------------------------------------------
  describe('findRawById', () => {
    it('should return raw document without lean()', async () => {
      const rawDoc = makeMockPlaybook();
      const chain: Record<string, jest.Mock> = {};
      chain.exec = jest.fn().mockResolvedValue(rawDoc);
      playbookModel.findById.mockReturnValue(chain);

      const result = await service.findRawById(MOCK_PLAYBOOK_ID);

      expect(playbookModel.findById).toHaveBeenCalledWith(MOCK_PLAYBOOK_ID);
      expect(chain.exec).toHaveBeenCalled();
      expect(result).toBe(rawDoc);
    });

    it('should return null when not found', async () => {
      const chain: Record<string, jest.Mock> = {};
      chain.exec = jest.fn().mockResolvedValue(null);
      playbookModel.findById.mockReturnValue(chain);

      const result = await service.findRawById(MOCK_PLAYBOOK_ID);

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getNextExecutionNumber
  // -------------------------------------------------------------------------
  describe('getNextExecutionNumber', () => {
    it('should return last execution number + 1', async () => {
      const chain = createQueryChain({ executionNumber: 5 });
      executionModel.findOne.mockReturnValue(chain);

      const result = await service.getNextExecutionNumber(MOCK_PLAYBOOK_ID);

      expect(result).toBe(6);
      expect(chain.sort).toHaveBeenCalledWith({ executionNumber: -1 });
      expect(chain.select).toHaveBeenCalledWith('executionNumber');
    });

    it('should return 1 when no executions exist', async () => {
      const chain = createQueryChain(null);
      executionModel.findOne.mockReturnValue(chain);

      const result = await service.getNextExecutionNumber(MOCK_PLAYBOOK_ID);

      expect(result).toBe(1);
    });

    it('should return 1 when last execution has executionNumber 0', async () => {
      const chain = createQueryChain({ executionNumber: 0 });
      executionModel.findOne.mockReturnValue(chain);

      const result = await service.getNextExecutionNumber(MOCK_PLAYBOOK_ID);

      expect(result).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // findExecutionsByPlaybook
  // -------------------------------------------------------------------------
  describe('findExecutionsByPlaybook', () => {
    it('should return paginated execution summaries', async () => {
      const execDoc = makeMockExecution();
      const chain = createQueryChain([execDoc]);
      executionModel.find.mockReturnValue(chain);
      executionModel.countDocuments.mockResolvedValue(1);

      const result = await service.findExecutionsByPlaybook(MOCK_PLAYBOOK_ID, {});

      expect(result.executions).toHaveLength(1);
      expect(result.executions[0].id).toBe(MOCK_EXECUTION_ID);
      expect(result.executions[0].executionNumber).toBe(1);
      expect(result.executions[0].status).toBe('completed');
      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
    });

    it('should apply custom page and limit', async () => {
      const chain = createQueryChain([]);
      executionModel.find.mockReturnValue(chain);
      executionModel.countDocuments.mockResolvedValue(50);

      const result = await service.findExecutionsByPlaybook(MOCK_PLAYBOOK_ID, {
        page: 2,
        limit: 10,
      });

      expect(chain.skip).toHaveBeenCalledWith(10); // (2-1)*10
      expect(chain.limit).toHaveBeenCalledWith(10);
      expect(result.pagination.page).toBe(2);
      expect(result.pagination.totalPages).toBe(5);
    });

    it('should exclude heavy fields via select', async () => {
      const chain = createQueryChain([]);
      executionModel.find.mockReturnValue(chain);
      executionModel.countDocuments.mockResolvedValue(0);

      await service.findExecutionsByPlaybook(MOCK_PLAYBOOK_ID, {});

      expect(chain.select).toHaveBeenCalledWith(
        '-taskResults -playbookSnapshot -interruptPayload -threadId',
      );
    });

    it('should sort by createdAt descending', async () => {
      const chain = createQueryChain([]);
      executionModel.find.mockReturnValue(chain);
      executionModel.countDocuments.mockResolvedValue(0);

      await service.findExecutionsByPlaybook(MOCK_PLAYBOOK_ID, {});

      expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    });
  });

  // -------------------------------------------------------------------------
  // findExecutionById
  // -------------------------------------------------------------------------
  describe('findExecutionById', () => {
    it('should return full execution response with task results', async () => {
      const execDoc = makeMockExecution();
      const chain = createQueryChain(execDoc);
      executionModel.findOne.mockReturnValue(chain);

      const result = await service.findExecutionById(MOCK_PLAYBOOK_ID, MOCK_EXECUTION_ID);

      expect(result.id).toBe(MOCK_EXECUTION_ID);
      expect(result.taskResults).toHaveLength(1);
      expect(result.taskResults[0].taskId).toBe('task-1');
      expect(result.taskResults[0].agentName).toBe('Agent A');
      expect(result.taskResults[0].inputTokens).toBe(10);
      expect(result.taskResults[0].modelName).toBe('gpt-4');
      expect(result.totalInputTokens).toBe(10);
      expect(result.totalOutputTokens).toBe(20);
      expect(result.totalTokens).toBe(30);
      expect(result.threadId).toBe('thread-abc');
      expect(result.playbookSnapshot).toEqual({ name: 'snap' });
    });

    it('should throw NotFoundException for non-existent execution', async () => {
      const chain = createQueryChain(null);
      executionModel.findOne.mockReturnValue(chain);

      await expect(
        service.findExecutionById(MOCK_PLAYBOOK_ID, MOCK_EXECUTION_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('should query with both playbookId and executionId as ObjectIds', async () => {
      const chain = createQueryChain(makeMockExecution());
      executionModel.findOne.mockReturnValue(chain);

      await service.findExecutionById(MOCK_PLAYBOOK_ID, MOCK_EXECUTION_ID);

      const query = executionModel.findOne.mock.calls[0][0];
      expect(query._id).toBeInstanceOf(Types.ObjectId);
      expect(query._id.toHexString()).toBe(MOCK_EXECUTION_ID);
      expect(query.playbookId).toBeInstanceOf(Types.ObjectId);
      expect(query.playbookId.toHexString()).toBe(MOCK_PLAYBOOK_ID);
    });

    it('should handle execution with empty taskResults', async () => {
      const execDoc = makeMockExecution({ taskResults: [] });
      const chain = createQueryChain(execDoc);
      executionModel.findOne.mockReturnValue(chain);

      const result = await service.findExecutionById(MOCK_PLAYBOOK_ID, MOCK_EXECUTION_ID);

      expect(result.taskResults).toEqual([]);
    });

    it('should handle execution with null optional fields', async () => {
      const execDoc = makeMockExecution({
        threadId: null,
        interruptPayload: null,
        error: null,
        durationMs: null,
        startedAt: null,
        completedAt: null,
        singleStepTaskId: null,
        playbookSnapshot: null,
      });
      const chain = createQueryChain(execDoc);
      executionModel.findOne.mockReturnValue(chain);

      const result = await service.findExecutionById(MOCK_PLAYBOOK_ID, MOCK_EXECUTION_ID);

      expect(result.threadId).toBeNull();
      expect(result.interruptPayload).toBeNull();
      expect(result.error).toBeNull();
      expect(result.durationMs).toBeNull();
      expect(result.singleStepTaskId).toBeNull();
      expect(result.playbookSnapshot).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getDesignMessages
  // -------------------------------------------------------------------------
  describe('getDesignMessages', () => {
    it('should return design messages sorted by createdAt ascending', async () => {
      const msg = makeMockDesignMessage();
      const chain = createQueryChain([msg]);
      designMessageModel.find.mockReturnValue(chain);

      const result = await service.getDesignMessages(MOCK_PLAYBOOK_ID);

      expect(chain.sort).toHaveBeenCalledWith({ createdAt: 1 });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(MOCK_MESSAGE_ID);
      expect(result[0].playbookId).toBe(MOCK_PLAYBOOK_ID);
      expect(result[0].userQuery).toBe('Add a new task');
      expect(result[0].aiSummary).toBe('Added task-2');
      expect(result[0].status).toBe('completed');
      expect(result[0].revertedFromMessageId).toBeNull();
      expect(result[0].error).toBeNull();
    });

    it('should return empty array when no messages exist', async () => {
      const chain = createQueryChain([]);
      designMessageModel.find.mockReturnValue(chain);

      const result = await service.getDesignMessages(MOCK_PLAYBOOK_ID);

      expect(result).toEqual([]);
    });

    it('should map revertedFromMessageId to string when present', async () => {
      const revertId = new Types.ObjectId();
      const msg = makeMockDesignMessage({ revertedFromMessageId: revertId });
      const chain = createQueryChain([msg]);
      designMessageModel.find.mockReturnValue(chain);

      const result = await service.getDesignMessages(MOCK_PLAYBOOK_ID);

      expect(result[0].revertedFromMessageId).toBe(revertId.toString());
    });

    it('should handle messages with missing optional fields', async () => {
      const msg = makeMockDesignMessage({
        aiSummary: undefined,
        snapshotBefore: undefined,
        error: undefined,
      });
      const chain = createQueryChain([msg]);
      designMessageModel.find.mockReturnValue(chain);

      const result = await service.getDesignMessages(MOCK_PLAYBOOK_ID);

      expect(result[0].aiSummary).toBe('');
      expect(result[0].snapshotBefore).toEqual({ tasks: [], edges: [] });
      expect(result[0].error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // revertToSnapshot
  // -------------------------------------------------------------------------
  describe('revertToSnapshot', () => {
    const snapshotTasks = [makeMockTask({ id: 'old-task' })];
    const snapshotEdges = [makeMockEdge({ id: 'old-edge' })];

    it('should revert playbook to snapshot and create revert message', async () => {
      // findOne for original message
      const originalMsg = makeMockDesignMessage({
        snapshotBefore: { tasks: snapshotTasks, edges: snapshotEdges },
      });
      const msgChain = createQueryChain(originalMsg);
      designMessageModel.findOne.mockReturnValue(msgChain);

      // findById for current playbook
      const currentPlaybook = makeMockPlaybook({
        tasks: [makeMockTask({ id: 'current-task' })],
        edges: [makeMockEdge({ id: 'current-edge' })],
      });
      const pbFindChain = createQueryChain(currentPlaybook);
      playbookModel.findById.mockReturnValue(pbFindChain);

      // findByIdAndUpdate for reverting
      const revertedPlaybook = makeMockPlaybook({
        tasks: snapshotTasks,
        edges: snapshotEdges,
      });
      const pbUpdateChain = createQueryChain(revertedPlaybook);
      playbookModel.findByIdAndUpdate.mockReturnValue(pbUpdateChain);

      // create revert message
      const revertMsgId = new Types.ObjectId();
      designMessageModel.create.mockResolvedValue({
        _id: revertMsgId,
        playbookId: objectId(MOCK_PLAYBOOK_ID),
        createdBy: objectId(MOCK_USER_ID),
        userQuery: '',
        aiSummary: '',
        snapshotBefore: {
          tasks: [makeMockTask({ id: 'current-task' })],
          edges: [makeMockEdge({ id: 'current-edge' })],
        },
        status: 'reverted',
        revertedFromMessageId: objectId(MOCK_MESSAGE_ID),
        error: null,
        createdAt: now,
        updatedAt: now,
      });

      const result = await service.revertToSnapshot(MOCK_PLAYBOOK_ID, MOCK_MESSAGE_ID, MOCK_USER_ID);

      // Verify message lookup
      const msgQuery = designMessageModel.findOne.mock.calls[0][0];
      expect(msgQuery._id.toHexString()).toBe(MOCK_MESSAGE_ID);
      expect(msgQuery.playbookId.toHexString()).toBe(MOCK_PLAYBOOK_ID);

      // Verify playbook update with snapshot data
      expect(playbookModel.findByIdAndUpdate).toHaveBeenCalledWith(
        MOCK_PLAYBOOK_ID,
        { $set: { tasks: snapshotTasks, edges: snapshotEdges } },
        { new: true },
      );

      // Verify revert message creation
      expect(designMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userQuery: '',
          aiSummary: '',
          status: 'reverted',
        }),
      );
      const createArg = designMessageModel.create.mock.calls[0][0];
      expect(createArg.revertedFromMessageId.toHexString()).toBe(MOCK_MESSAGE_ID);
      // snapshotBefore should capture the CURRENT state (before revert)
      expect(createArg.snapshotBefore.tasks[0].id).toBe('current-task');

      // Verify return
      expect(result.playbook.id).toBe(MOCK_PLAYBOOK_ID);
      expect(result.message.status).toBe('reverted');
      expect(result.message.revertedFromMessageId).toBe(MOCK_MESSAGE_ID);

      expect(loggerService.log).toHaveBeenCalledWith(
        'Playbook reverted to snapshot',
        expect.objectContaining({ playbookId: MOCK_PLAYBOOK_ID, messageId: MOCK_MESSAGE_ID }),
      );
    });

    it('should throw NotFoundException when original message not found', async () => {
      const chain = createQueryChain(null);
      designMessageModel.findOne.mockReturnValue(chain);

      await expect(
        service.revertToSnapshot(MOCK_PLAYBOOK_ID, MOCK_MESSAGE_ID, MOCK_USER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when current playbook not found', async () => {
      const msgChain = createQueryChain(makeMockDesignMessage());
      designMessageModel.findOne.mockReturnValue(msgChain);

      const pbChain = createQueryChain(null);
      playbookModel.findById.mockReturnValue(pbChain);

      await expect(
        service.revertToSnapshot(MOCK_PLAYBOOK_ID, MOCK_MESSAGE_ID, MOCK_USER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when findByIdAndUpdate returns null', async () => {
      const msgChain = createQueryChain(makeMockDesignMessage());
      designMessageModel.findOne.mockReturnValue(msgChain);

      const pbFindChain = createQueryChain(makeMockPlaybook());
      playbookModel.findById.mockReturnValue(pbFindChain);

      const pbUpdateChain = createQueryChain(null);
      playbookModel.findByIdAndUpdate.mockReturnValue(pbUpdateChain);

      await expect(
        service.revertToSnapshot(MOCK_PLAYBOOK_ID, MOCK_MESSAGE_ID, MOCK_USER_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // cloneForUser
  // -------------------------------------------------------------------------
  describe('cloneForUser', () => {
    it('should create a copy with new owner and "(shared)" suffix', async () => {
      const source = makeMockPlaybook({
        name: 'Original',
        description: 'Orig desc',
        tasks: [makeMockTask()],
        edges: [makeMockEdge()],
        workspaces: [objectId(MOCK_WORKSPACE_ID)],
      });
      const findChain = createQueryChain(source);
      playbookModel.findById.mockReturnValue(findChain);

      const targetUserId = new Types.ObjectId().toHexString();
      const clonedDoc = makeMockPlaybook({
        _id: new Types.ObjectId(),
        name: 'Original (shared)',
        createdBy: objectId(targetUserId),
      });
      playbookModel.create.mockResolvedValue(clonedDoc);
      const executionFindChain = createQueryChain([]);
      executionModel.find.mockReturnValue(executionFindChain);
      executionModel.insertMany.mockResolvedValue([]);

      const result = await service.cloneForUser(MOCK_PLAYBOOK_ID, targetUserId);

      expect(playbookModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Original (shared)',
          description: 'Orig desc',
          tasks: source.tasks,
          edges: source.edges,
          workspaces: source.workspaces,
          isActive: true,
        }),
      );
      const createArg = playbookModel.create.mock.calls[0][0];
      expect(createArg.createdBy.toHexString()).toBe(targetUserId);

      expect(result.name).toBe('Original (shared)');
      expect(executionModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          status: { $nin: [ExecutionStatus.PENDING, ExecutionStatus.RUNNING] },
        }),
      );
      expect(loggerService.log).toHaveBeenCalledWith(
        'Playbook cloned',
        expect.objectContaining({ sourceId: MOCK_PLAYBOOK_ID, targetUserId }),
      );
    });

    it('should clone historical executions for the copied playbook', async () => {
      const source = makeMockPlaybook({ name: 'Original' });
      const findChain = createQueryChain(source);
      playbookModel.findById.mockReturnValue(findChain);

      const targetUserId = new Types.ObjectId().toHexString();
      const clonedPlaybookId = new Types.ObjectId();
      playbookModel.create.mockResolvedValue(
        makeMockPlaybook({
          _id: clonedPlaybookId,
          name: 'Original (shared)',
          createdBy: objectId(targetUserId),
        }),
      );

      const sourceExecution = makeMockExecution({
        _id: new Types.ObjectId(),
        threadId: 'thread-keep-out',
        playbookId: objectId(MOCK_PLAYBOOK_ID),
        executedBy: objectId(MOCK_USER_ID),
        attemptHistory: [
          {
            attemptNumber: 1,
            type: 'initial',
            taskId: null,
            threadId: 'attempt-thread',
            startedAt: now,
            completedAt: now,
          },
        ],
      });
      const executionFindChain = createQueryChain([sourceExecution]);
      executionModel.find.mockReturnValue(executionFindChain);
      executionModel.insertMany.mockResolvedValue([]);

      await service.cloneForUser(MOCK_PLAYBOOK_ID, targetUserId);

      expect(executionModel.insertMany).toHaveBeenCalledWith([
        expect.objectContaining({
          playbookId: expect.any(Types.ObjectId),
          executedBy: expect.any(Types.ObjectId),
          executionNumber: sourceExecution.executionNumber,
          status: sourceExecution.status,
          taskResults: sourceExecution.taskResults,
          threadId: null,
          attemptHistory: [
            expect.objectContaining({
              attemptNumber: 1,
              threadId: null,
            }),
          ],
        }),
      ]);

      const insertedExecution = executionModel.insertMany.mock.calls[0][0][0];
      expect(insertedExecution.playbookId.toHexString()).toBe(clonedPlaybookId.toHexString());
      expect(insertedExecution.executedBy.toHexString()).toBe(targetUserId);
      expect(insertedExecution).not.toHaveProperty('_id');
    });

    it('should throw NotFoundException when source playbook not found', async () => {
      const chain = createQueryChain(null);
      playbookModel.findById.mockReturnValue(chain);

      await expect(
        service.cloneForUser(MOCK_PLAYBOOK_ID, new Types.ObjectId().toHexString()),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle source with empty tasks, edges, and workspaces', async () => {
      const source = makeMockPlaybook({
        tasks: undefined,
        edges: undefined,
        workspaces: undefined,
        description: undefined,
      });
      const findChain = createQueryChain(source);
      playbookModel.findById.mockReturnValue(findChain);

      const clonedDoc = makeMockPlaybook({ name: 'Test Playbook (shared)' });
      playbookModel.create.mockResolvedValue(clonedDoc);
      const executionFindChain = createQueryChain([]);
      executionModel.find.mockReturnValue(executionFindChain);
      executionModel.insertMany.mockResolvedValue([]);

      const targetUserId = new Types.ObjectId().toHexString();
      await service.cloneForUser(MOCK_PLAYBOOK_ID, targetUserId);

      const createArg = playbookModel.create.mock.calls[0][0];
      expect(createArg.tasks).toEqual([]);
      expect(createArg.edges).toEqual([]);
      expect(createArg.workspaces).toEqual([]);
      expect(createArg.description).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // Response mapping (private methods tested via public methods)
  // -------------------------------------------------------------------------
  describe('response mapping', () => {
    it('should map playbook task fields correctly in mapToResponse', async () => {
      const agentId = new Types.ObjectId();
      const task = makeMockTask({
        assignedAgentId: agentId,
        interruptBefore: true,
        interruptAfter: true,
        allowClarification: true,
        clarificationPrompt: 'Clarify?',
        maxClarifications: 5,
        inputKeys: ['k1', 'k2'],
        outputKey: 'out',
        notifyOnComplete: true,
        notifyEmails: ['a@b.com'],
      });
      const mockDoc = makeMockPlaybook({ tasks: [task] });
      const chain = createQueryChain(mockDoc);
      playbookModel.findById.mockReturnValue(chain);

      const result = await service.findById(MOCK_PLAYBOOK_ID);
      const t = result.tasks[0];

      expect(t.assignedAgentId).toBe(agentId.toString());
      expect(t.interruptBefore).toBe(true);
      expect(t.interruptAfter).toBe(true);
      expect(t.allowClarification).toBe(true);
      expect(t.clarificationPrompt).toBe('Clarify?');
      expect(t.maxClarifications).toBe(5);
      expect(t.inputKeys).toEqual(['k1', 'k2']);
      expect(t.outputKey).toBe('out');
      expect(t.notifyOnComplete).toBe(true);
      expect(t.notifyEmails).toEqual(['a@b.com']);
    });

    it('should default missing task fields in mapToResponse', async () => {
      const task = { id: 't-min', title: 'Minimal' };
      const mockDoc = makeMockPlaybook({ tasks: [task] });
      const chain = createQueryChain(mockDoc);
      playbookModel.findById.mockReturnValue(chain);

      const result = await service.findById(MOCK_PLAYBOOK_ID);
      const t = result.tasks[0];

      expect(t.description).toBe('');
      expect(t.assignedAgentId).toBeNull();
      expect(t.executionOrder).toBe(0);
      expect(t.positionX).toBe(0);
      expect(t.positionY).toBe(0);
      expect(t.interruptBefore).toBe(false);
      expect(t.interruptAfter).toBe(false);
      expect(t.allowClarification).toBe(false);
      expect(t.clarificationPrompt).toBe('');
      expect(t.maxClarifications).toBe(3);
      expect(t.inputKeys).toEqual([]);
      expect(t.outputKey).toBe('');
      expect(t.notifyOnComplete).toBe(false);
      expect(t.notifyEmails).toEqual([]);
    });

    it('should map edge fields in mapToResponse', async () => {
      const edge = makeMockEdge({ id: 'e-x', sourceId: 'a', targetId: 'b' });
      const mockDoc = makeMockPlaybook({ edges: [edge] });
      const chain = createQueryChain(mockDoc);
      playbookModel.findById.mockReturnValue(chain);

      const result = await service.findById(MOCK_PLAYBOOK_ID);

      expect(result.edges[0]).toEqual({ id: 'e-x', sourceId: 'a', targetId: 'b' });
    });

    it('should map workspace ObjectIds to strings', async () => {
      const ws1 = new Types.ObjectId();
      const ws2 = new Types.ObjectId();
      const mockDoc = makeMockPlaybook({ workspaces: [ws1, ws2] });
      const chain = createQueryChain(mockDoc);
      playbookModel.findById.mockReturnValue(chain);

      const result = await service.findById(MOCK_PLAYBOOK_ID);

      expect(result.workspaces).toEqual([ws1.toHexString(), ws2.toHexString()]);
    });

    it('should handle playbook with no tasks or edges', async () => {
      const mockDoc = makeMockPlaybook({ tasks: undefined, edges: undefined });
      const chain = createQueryChain(mockDoc);
      playbookModel.findById.mockReturnValue(chain);

      const result = await service.findById(MOCK_PLAYBOOK_ID);

      expect(result.tasks).toEqual([]);
      expect(result.edges).toEqual([]);
    });

    it('should handle playbook with no workspaces', async () => {
      const mockDoc = makeMockPlaybook({ workspaces: undefined });
      const chain = createQueryChain(mockDoc);
      playbookModel.findById.mockReturnValue(chain);

      const result = await service.findById(MOCK_PLAYBOOK_ID);

      expect(result.workspaces).toEqual([]);
    });

    it('should use .id fallback when _id is absent in mapToResponse', async () => {
      const mockDoc = makeMockPlaybook();
      (mockDoc as any).id = MOCK_PLAYBOOK_ID;
      delete (mockDoc as any)._id;
      const chain = createQueryChain(mockDoc);
      playbookModel.findById.mockReturnValue(chain);

      const result = await service.findById(MOCK_PLAYBOOK_ID);

      expect(result.id).toBe(MOCK_PLAYBOOK_ID);
    });

    it('should map summary response correctly via findAllByUser', async () => {
      const summaryDoc = {
        _id: objectId(MOCK_PLAYBOOK_ID),
        name: 'Summary PB',
        description: 'desc',
        taskCount: 3,
        isFavorite: true,
        lastExecutionAt: now,
        createdAt: now,
        updatedAt: now,
      };
      playbookModel.aggregate.mockResolvedValue([
        { metadata: [{ total: 1 }], data: [summaryDoc] },
      ]);

      const result = await service.findAllByUser(MOCK_USER_ID, {});

      const s = result.playbooks[0];
      expect(s.id).toBe(MOCK_PLAYBOOK_ID);
      expect(s.name).toBe('Summary PB');
      expect(s.taskCount).toBe(3);
      expect(s.isFavorite).toBe(true);
    });

    it('should handle execution summary mapping with null dates', async () => {
      const execDoc = makeMockExecution({ startedAt: null, completedAt: null, durationMs: null });
      const chain = createQueryChain([execDoc]);
      executionModel.find.mockReturnValue(chain);
      executionModel.countDocuments.mockResolvedValue(1);

      const result = await service.findExecutionsByPlaybook(MOCK_PLAYBOOK_ID, {});

      const summary = result.executions[0];
      expect(summary.startedAt).toBeNull();
      expect(summary.completedAt).toBeNull();
      expect(summary.durationMs).toBeNull();
    });

    it('should map task result token fields as null when absent', async () => {
      const execDoc = makeMockExecution({
        taskResults: [
          {
            taskId: 'task-1',
            nodeTitle: 'Task 1',
            order: 1,
            status: 'completed',
            output: 'ok',
            error: null,
            durationMs: 100,
            startedAt: now,
            completedAt: now,
            // missing: components, inputTokens, outputTokens, totalTokens, modelName, agentName
          },
        ],
      });
      const chain = createQueryChain(execDoc);
      executionModel.findOne.mockReturnValue(chain);

      const result = await service.findExecutionById(MOCK_PLAYBOOK_ID, MOCK_EXECUTION_ID);
      const tr = result.taskResults[0];

      expect(tr.agentName).toBe('');
      expect(tr.components).toEqual([]);
      expect(tr.inputTokens).toBeNull();
      expect(tr.outputTokens).toBeNull();
      expect(tr.totalTokens).toBeNull();
      expect(tr.modelName).toBeNull();
    });
  });
});
