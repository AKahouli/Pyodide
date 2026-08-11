import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { PlaybookContextService } from './playbook-context.service';
import { LoggerService } from '../../logger';
import { WorkspaceDocumentService } from '../../workspace/workspace-document.service';
import { DocumentStatus } from '../../workspace/schemas/workspace-document.schema';
import { IGrpcAgent, IGrpcWorkspaceContext } from '../../agent/interfaces/agent.interface';
import { Workspace, WorkspaceDocument } from '../../workspace/schemas/workspace.schema';
import { WorkspaceSetting, WorkspaceSettingDocument } from '../../workspace/schemas/workspace-setting.schema';

describe('PlaybookContextService', () => {
  let service: PlaybookContextService;
  let workspaceDocumentService: jest.Mocked<WorkspaceDocumentService>;
  let loggerService: jest.Mocked<LoggerService>;
  let workspaceModel: any;
  let workspaceSettingModel: any;

  const mockDocument = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'doc-1',
    originalName: 'report.pdf',
    path: '/docs/report.pdf',
    detected_language: 'en',
    chunk_size: 800,
    createdAt: '2026-01-15T10:00:00.000Z',
    ...overrides,
  });

  const mockPaginatedResult = (documents: Record<string, unknown>[] = [mockDocument()]) => ({
    documents,
    pagination: { page: 1, limit: 1000, total: documents.length, totalPages: 1 },
  });

  const makeAgent = (overrides: Partial<IGrpcAgent> = {}): IGrpcAgent => ({
    id: 'agent-1',
    name: 'Test Agent',
    description: 'A test agent',
    prompt: 'You are a test agent',
    agent_type: 'assistant',
    save_memory: false,
    tools: [],
    brain_context: [],
    chatbot: { model: 'gpt-4', input_modalities: ['text'] },
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const mockLoggerService = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    const mockWorkspaceDocumentService = {
      findAllByWorkspace: jest.fn(),
    };

    const mockWorkspaceModelValue = {
      findById: jest.fn(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn(),
    };

    const mockWorkspaceSettingModelValue = {
      findById: jest.fn(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybookContextService,
        { provide: LoggerService, useValue: mockLoggerService },
        { provide: WorkspaceDocumentService, useValue: mockWorkspaceDocumentService },
        { provide: getModelToken(Workspace.name), useValue: mockWorkspaceModelValue },
        { provide: getModelToken(WorkspaceSetting.name), useValue: mockWorkspaceSettingModelValue },
      ],
    }).compile();

    service = module.get<PlaybookContextService>(PlaybookContextService);
    workspaceDocumentService = module.get(WorkspaceDocumentService);
    loggerService = module.get(LoggerService);
    workspaceModel = module.get(getModelToken(Workspace.name));
    workspaceSettingModel = module.get(getModelToken(WorkspaceSetting.name));

    // Set up default mocks for workspace model
    workspaceModel.findById.mockReturnValue(workspaceModel);
    workspaceSettingModel.findById.mockReturnValue(workspaceSettingModel);
  });

  describe('constructor', () => {
    it('should set logger context to PlaybookContextService', () => {
      expect(loggerService.setContext).toHaveBeenCalledWith('PlaybookContextService');
    });
  });

  describe('buildWorkspaceContexts', () => {
    it('should return empty array for empty workspaceIds', async () => {
      const result = await service.buildWorkspaceContexts([]);

      expect(result).toEqual([]);
      expect(workspaceDocumentService.findAllByWorkspace).not.toHaveBeenCalled();
    });

    it('should return empty array for null/undefined workspaceIds', async () => {
      const result = await service.buildWorkspaceContexts(null as unknown as string[]);

      expect(result).toEqual([]);
      expect(workspaceDocumentService.findAllByWorkspace).not.toHaveBeenCalled();
    });

    it('should fetch documents from workspace document service with correct params', async () => {
      workspaceDocumentService.findAllByWorkspace.mockResolvedValue(
        mockPaginatedResult() as any,
      );

      await service.buildWorkspaceContexts(['ws-1']);

      expect(workspaceDocumentService.findAllByWorkspace).toHaveBeenCalledWith('ws-1', {
        limit: 1000,
        status: DocumentStatus.COMPLETED,
      });
    });

    it('should map document fields correctly', async () => {
      const doc = mockDocument({
        id: 'doc-42',
        originalName: 'analysis.pdf',
        path: '/docs/analysis.pdf',
        detected_language: 'en',
        chunk_size: 800,
        createdAt: '2026-01-15T10:00:00.000Z',
      });
      workspaceDocumentService.findAllByWorkspace.mockResolvedValue(
        mockPaginatedResult([doc]) as any,
      );

      const result = await service.buildWorkspaceContexts(['ws-1']);

      expect(result).toHaveLength(1);
      expect(result[0].workspace_id).toBe('ws-1');
      expect(result[0].workspace_documents).toHaveLength(1);
      expect(result[0].workspace_documents[0]).toEqual({
        _id: 'doc-42',
        filename: 'analysis.pdf',
        filepath: '/docs/analysis.pdf',
        in_memory: false,
        language: 'en',
        indexing_token: 800,
        workspace_id: 'ws-1',
        createdAt: '2026-01-15T10:00:00.000Z',
      });
    });

    it('should default language to fr when detected_language is missing', async () => {
      const doc = mockDocument({ detected_language: undefined });
      workspaceDocumentService.findAllByWorkspace.mockResolvedValue(
        mockPaginatedResult([doc]) as any,
      );

      const result = await service.buildWorkspaceContexts(['ws-1']);

      expect(result[0].workspace_documents[0].language).toBe('fr');
    });

    it('should default indexing_token to 1200 when chunk_size is missing', async () => {
      const doc = mockDocument({ chunk_size: undefined });
      workspaceDocumentService.findAllByWorkspace.mockResolvedValue(
        mockPaginatedResult([doc]) as any,
      );

      const result = await service.buildWorkspaceContexts(['ws-1']);

      expect(result[0].workspace_documents[0].indexing_token).toBe(1200);
    });

    it('should handle workspace with no documents', async () => {
      workspaceDocumentService.findAllByWorkspace.mockResolvedValue(
        mockPaginatedResult([]) as any,
      );

      const result = await service.buildWorkspaceContexts(['ws-empty']);

      expect(result).toHaveLength(1);
      expect(result[0].workspace_id).toBe('ws-empty');
      expect(result[0].workspace_documents).toEqual([]);
    });

    it('should build contexts for multiple workspaces', async () => {
      const doc1 = mockDocument({ id: 'doc-1', originalName: 'file1.pdf' });
      const doc2 = mockDocument({ id: 'doc-2', originalName: 'file2.pdf' });
      const doc3 = mockDocument({ id: 'doc-3', originalName: 'file3.pdf' });

      workspaceDocumentService.findAllByWorkspace
        .mockResolvedValueOnce(mockPaginatedResult([doc1, doc2]) as any)
        .mockResolvedValueOnce(mockPaginatedResult([doc3]) as any);

      const result = await service.buildWorkspaceContexts(['ws-1', 'ws-2']);

      expect(result).toHaveLength(2);
      expect(result[0].workspace_id).toBe('ws-1');
      expect(result[0].workspace_documents).toHaveLength(2);
      expect(result[1].workspace_id).toBe('ws-2');
      expect(result[1].workspace_documents).toHaveLength(1);
    });

    it('should log workspace contexts summary after building', async () => {
      const doc1 = mockDocument({ id: 'doc-1' });
      const doc2 = mockDocument({ id: 'doc-2' });

      workspaceDocumentService.findAllByWorkspace
        .mockResolvedValueOnce(mockPaginatedResult([doc1]) as any)
        .mockResolvedValueOnce(mockPaginatedResult([doc2]) as any);

      await service.buildWorkspaceContexts(['ws-1', 'ws-2']);

      expect(loggerService.log).toHaveBeenCalledWith('Workspace contexts built for playbook', {
        workspaceCount: 2,
        totalDocuments: 2,
      });
    });

    it('should return empty array and log warning when workspace service throws', async () => {
      workspaceDocumentService.findAllByWorkspace.mockRejectedValue(
        new Error('Database connection failed'),
      );

      const result = await service.buildWorkspaceContexts(['ws-1']);

      expect(result).toEqual([]);
      expect(loggerService.warn).toHaveBeenCalledWith(
        'Failed to build workspace contexts for playbook',
        { error: 'Database connection failed' },
      );
    });

    it('should return empty array when error occurs mid-iteration across workspaces', async () => {
      workspaceDocumentService.findAllByWorkspace
        .mockResolvedValueOnce(mockPaginatedResult() as any)
        .mockRejectedValueOnce(new Error('Timeout on second workspace'));

      const result = await service.buildWorkspaceContexts(['ws-1', 'ws-2']);

      expect(result).toEqual([]);
      expect(loggerService.warn).toHaveBeenCalledWith(
        'Failed to build workspace contexts for playbook',
        { error: 'Timeout on second workspace' },
      );
    });
  });

  describe('resolveAgentBrainContexts', () => {
    it('should return early for agents with no brain_context workspace IDs', async () => {
      const agents = [makeAgent({ brain_context: [] })];

      await service.resolveAgentBrainContexts(agents);

      expect(workspaceDocumentService.findAllByWorkspace).not.toHaveBeenCalled();
    });

    it('should return early for empty agents array', async () => {
      await service.resolveAgentBrainContexts([]);

      expect(workspaceDocumentService.findAllByWorkspace).not.toHaveBeenCalled();
    });

    it('should resolve workspace documents and mutate agents in-place', async () => {
      const doc = mockDocument({ id: 'doc-1', originalName: 'brain-doc.pdf' });
      workspaceDocumentService.findAllByWorkspace.mockResolvedValue(
        mockPaginatedResult([doc]) as any,
      );

      const agents = [
        makeAgent({
          brain_context: [{ workspace_id: 'ws-1', workspace_documents: [] }],
        }),
      ];

      await service.resolveAgentBrainContexts(agents);

      expect(agents[0].brain_context).toHaveLength(1);
      expect(agents[0].brain_context[0].workspace_id).toBe('ws-1');
      expect(agents[0].brain_context[0].workspace_documents).toHaveLength(1);
      expect(agents[0].brain_context[0].workspace_documents[0]._id).toBe('doc-1');
    });

    it('should fetch workspace documents with correct params', async () => {
      workspaceDocumentService.findAllByWorkspace.mockResolvedValue(
        mockPaginatedResult() as any,
      );

      const agents = [
        makeAgent({
          brain_context: [{ workspace_id: 'ws-1', workspace_documents: [] }],
        }),
      ];

      await service.resolveAgentBrainContexts(agents);

      expect(workspaceDocumentService.findAllByWorkspace).toHaveBeenCalledWith('ws-1', {
        limit: 1000,
        status: DocumentStatus.COMPLETED,
      });
    });

    it('should deduplicate workspace IDs across multiple agents', async () => {
      workspaceDocumentService.findAllByWorkspace.mockResolvedValue(
        mockPaginatedResult() as any,
      );

      const agents = [
        makeAgent({
          id: 'agent-1',
          brain_context: [{ workspace_id: 'ws-shared', workspace_documents: [] }],
        }),
        makeAgent({
          id: 'agent-2',
          brain_context: [{ workspace_id: 'ws-shared', workspace_documents: [] }],
        }),
      ];

      await service.resolveAgentBrainContexts(agents);

      // Should only fetch once for the deduplicated workspace ID
      expect(workspaceDocumentService.findAllByWorkspace).toHaveBeenCalledTimes(1);
      expect(workspaceDocumentService.findAllByWorkspace).toHaveBeenCalledWith(
        'ws-shared',
        expect.any(Object),
      );
    });

    it('should resolve multiple workspace IDs for a single agent', async () => {
      const doc1 = mockDocument({ id: 'doc-1' });
      const doc2 = mockDocument({ id: 'doc-2' });

      workspaceDocumentService.findAllByWorkspace
        .mockResolvedValueOnce(mockPaginatedResult([doc1]) as any)
        .mockResolvedValueOnce(mockPaginatedResult([doc2]) as any);

      const agents = [
        makeAgent({
          brain_context: [
            { workspace_id: 'ws-1', workspace_documents: [] },
            { workspace_id: 'ws-2', workspace_documents: [] },
          ],
        }),
      ];

      await service.resolveAgentBrainContexts(agents);

      expect(agents[0].brain_context).toHaveLength(2);
      expect(workspaceDocumentService.findAllByWorkspace).toHaveBeenCalledTimes(2);
    });

    it('should handle promise rejections gracefully via allSettled', async () => {
      const doc = mockDocument({ id: 'doc-ok' });
      workspaceDocumentService.findAllByWorkspace
        .mockResolvedValueOnce(mockPaginatedResult([doc]) as any)
        .mockRejectedValueOnce(new Error('Workspace not found'));

      const agents = [
        makeAgent({
          brain_context: [
            { workspace_id: 'ws-ok', workspace_documents: [] },
            { workspace_id: 'ws-fail', workspace_documents: [] },
          ],
        }),
      ];

      await service.resolveAgentBrainContexts(agents);

      // Should not throw; the rejected workspace is simply not in the context map
      expect(loggerService.warn).toHaveBeenCalledWith(
        'Failed to resolve brain context workspace',
        {
          workspaceId: 'ws-fail',
          error: 'Workspace not found',
        },
      );
      // Only the successful workspace should remain in brain_context
      expect(agents[0].brain_context).toHaveLength(1);
      expect(agents[0].brain_context[0].workspace_id).toBe('ws-ok');
    });

    it('should filter out unresolved workspace contexts from agent brain_context', async () => {
      workspaceDocumentService.findAllByWorkspace.mockRejectedValue(
        new Error('Service unavailable'),
      );

      const agents = [
        makeAgent({
          brain_context: [{ workspace_id: 'ws-fail', workspace_documents: [] }],
        }),
      ];

      await service.resolveAgentBrainContexts(agents);

      // brain_context should be empty since all resolutions failed
      expect(agents[0].brain_context).toHaveLength(0);
    });

    it('should map document fields correctly in resolved context', async () => {
      const doc = mockDocument({
        id: 'doc-brain',
        originalName: 'brain-file.pdf',
        path: '/brain/brain-file.pdf',
        detected_language: 'de',
        chunk_size: 500,
        createdAt: '2026-02-01T12:00:00.000Z',
      });
      workspaceDocumentService.findAllByWorkspace.mockResolvedValue(
        mockPaginatedResult([doc]) as any,
      );

      const agents = [
        makeAgent({
          brain_context: [{ workspace_id: 'ws-brain', workspace_documents: [] }],
        }),
      ];

      await service.resolveAgentBrainContexts(agents);

      const resolvedDoc = agents[0].brain_context[0].workspace_documents[0];
      expect(resolvedDoc).toEqual({
        _id: 'doc-brain',
        filename: 'brain-file.pdf',
        filepath: '/brain/brain-file.pdf',
        in_memory: false,
        language: 'de',
        indexing_token: 500,
        workspace_id: 'ws-brain',
        createdAt: '2026-02-01T12:00:00.000Z',
      });
    });

    it('should log summary after resolving all agent brain contexts', async () => {
      const doc1 = mockDocument({ id: 'doc-1' });
      const doc2 = mockDocument({ id: 'doc-2' });

      workspaceDocumentService.findAllByWorkspace
        .mockResolvedValueOnce(mockPaginatedResult([doc1]) as any)
        .mockResolvedValueOnce(mockPaginatedResult([doc2]) as any);

      const agents = [
        makeAgent({
          id: 'agent-1',
          brain_context: [{ workspace_id: 'ws-1', workspace_documents: [] }],
        }),
        makeAgent({
          id: 'agent-2',
          brain_context: [{ workspace_id: 'ws-2', workspace_documents: [] }],
        }),
      ];

      await service.resolveAgentBrainContexts(agents);

      expect(loggerService.log).toHaveBeenCalledWith('Agent brain contexts resolved', {
        agentCount: 2,
        workspaceCount: 2,
        totalDocuments: 2,
      });
    });

    it('should handle multiple agents with overlapping and unique workspace IDs', async () => {
      const docShared = mockDocument({ id: 'doc-shared' });
      const docUnique = mockDocument({ id: 'doc-unique' });

      workspaceDocumentService.findAllByWorkspace
        .mockResolvedValueOnce(mockPaginatedResult([docShared]) as any)
        .mockResolvedValueOnce(mockPaginatedResult([docUnique]) as any);

      const agents = [
        makeAgent({
          id: 'agent-1',
          brain_context: [
            { workspace_id: 'ws-shared', workspace_documents: [] },
            { workspace_id: 'ws-unique', workspace_documents: [] },
          ],
        }),
        makeAgent({
          id: 'agent-2',
          brain_context: [{ workspace_id: 'ws-shared', workspace_documents: [] }],
        }),
      ];

      await service.resolveAgentBrainContexts(agents);

      // ws-shared + ws-unique = 2 unique IDs, 2 calls
      expect(workspaceDocumentService.findAllByWorkspace).toHaveBeenCalledTimes(2);

      // Agent 1 should have both contexts
      expect(agents[0].brain_context).toHaveLength(2);
      // Agent 2 should have the shared context
      expect(agents[1].brain_context).toHaveLength(1);
      expect(agents[1].brain_context[0].workspace_id).toBe('ws-shared');
    });

    it('should default language to fr and indexing_token to 1200 for missing fields', async () => {
      const doc = mockDocument({ detected_language: undefined, chunk_size: undefined });
      workspaceDocumentService.findAllByWorkspace.mockResolvedValue(
        mockPaginatedResult([doc]) as any,
      );

      const agents = [
        makeAgent({
          brain_context: [{ workspace_id: 'ws-1', workspace_documents: [] }],
        }),
      ];

      await service.resolveAgentBrainContexts(agents);

      const resolvedDoc = agents[0].brain_context[0].workspace_documents[0];
      expect(resolvedDoc.language).toBe('fr');
      expect(resolvedDoc.indexing_token).toBe(1200);
    });
  });
});
