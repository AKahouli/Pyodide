import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { lookup } from 'dns/promises';
import axios from 'axios';
import { WorkspaceDocumentService } from './workspace-document.service';
import { BadRequestException } from '../exceptions';

jest.mock('dns/promises');
jest.mock('axios');
import { WorkspaceDoc, DocumentStatus } from './schemas/workspace-document.schema';
import { UploadSession } from './schemas/upload-session.schema';
import { WorkspaceService } from './workspace.service';
import { DocumentService } from '../document/document.service';
import { NotificationsService } from '../notifications/notifications.service';
import { IndexingService } from '../indexing/indexing.service';
import { UrlToPdfClientService } from './services/url-to-pdf-client.service';
import { WebsiteCrawlerService } from './services/website-crawler.service';
import { LoggerService } from '../logger';
import { WorkspaceUploadSettingsService } from '../system/workspace-upload-settings.service';
import {
  DEFAULT_WORKSPACE_UPLOAD_EXTENSIONS,
} from '../system/constants/workspace-upload-settings.constants';

const WS_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f191e810c19729de860ea';

describe('WorkspaceDocumentService.createFromAiArtifact', () => {
  let svc: WorkspaceDocumentService;
  let create: jest.Mock;
  let updateStorageUsage: jest.Mock;

  beforeEach(async () => {
    create = jest.fn().mockResolvedValue({});
    updateStorageUsage = jest.fn().mockResolvedValue(undefined);

    const mod = await Test.createTestingModule({
      providers: [
        WorkspaceDocumentService,
        { provide: getModelToken(WorkspaceDoc.name), useValue: { create } },
        { provide: getModelToken(UploadSession.name), useValue: {} },
        {
          provide: WorkspaceService,
          useValue: {
            updateStorageUsage,
            findById: jest.fn().mockResolvedValue({
              id: WS_ID,
              createdBy: USER_ID,
            }),
          },
        },
        { provide: DocumentService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: IndexingService, useValue: {} },
        { provide: UrlToPdfClientService, useValue: { convert: jest.fn() } },
        { provide: WebsiteCrawlerService, useValue: { crawl: jest.fn() } },
        {
          provide: ConfigService,
          useValue: { get: (_: string, dflt?: unknown) => dflt },
        },
        {
          provide: WorkspaceUploadSettingsService,
          useValue: {
            getAllowedExtensions: jest.fn().mockResolvedValue([...DEFAULT_WORKSPACE_UPLOAD_EXTENSIONS]),
            getAllowedMimeTypesForExtension: jest.fn((ext: string) => {
              const map: Record<string, string> = {
                '.pdf': 'application/pdf',
                '.png': 'image/png',
              };
              return map[ext] ? [map[ext]] : [];
            }),
            ensureDefaultSettings: jest.fn().mockResolvedValue(undefined),
            getSettings: jest.fn().mockResolvedValue({ allowedExtensions: [...DEFAULT_WORKSPACE_UPLOAD_EXTENSIONS] }),
          },
        },
        {
          provide: LoggerService,
          useValue: {
            setContext: jest.fn(),
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
          },
        },
      ],
    }).compile();

    svc = mod.get(WorkspaceDocumentService);
  });

  it('creates a WorkspaceDocument row pointing at the AI-emitted path', async () => {
    await svc.createFromAiArtifact(WS_ID, {
      id: 'f1',
      name: 'report.pdf',
      content_type: 'application/pdf',
      path: `${USER_ID}/files_generated/report.pdf`,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'report.pdf',
        originalName: 'report.pdf',
        mimeType: 'application/pdf',
        path: `${USER_ID}/files_generated/report.pdf`,
        size: 0,
        status: DocumentStatus.COMPLETED,
      }),
    );
    expect(updateStorageUsage).toHaveBeenCalledWith(WS_ID, 0, 1);
  });

  it('falls back to application/octet-stream when content_type is empty', async () => {
    await svc.createFromAiArtifact(WS_ID, {
      id: 'f2',
      name: 'data.bin',
      content_type: '',
      path: `${USER_ID}/files_generated/data.bin`,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'application/octet-stream' }),
    );
  });
});

describe('WorkspaceDocumentService upload validation', () => {
  let svc: WorkspaceDocumentService;
  let create: jest.Mock;
  let getAllowedExtensions: jest.Mock;

  beforeEach(async () => {
    create = jest.fn().mockResolvedValue({ _id: 'doc1' });
    getAllowedExtensions = jest.fn().mockResolvedValue(['.pdf', '.png']);

    const exists = jest.fn().mockReturnValue({ lean: () => Promise.resolve(null) });

    const mod = await Test.createTestingModule({
      providers: [
        WorkspaceDocumentService,
        { provide: getModelToken(WorkspaceDoc.name), useValue: { create, exists } },
        { provide: getModelToken(UploadSession.name), useValue: {} },
        {
          provide: WorkspaceService,
          useValue: {
            updateStorageUsage: jest.fn().mockResolvedValue(undefined),
            getStorageContext: jest.fn().mockResolvedValue({ ownerUserId: USER_ID, storagePrefix: 'ws' }),
            checkStorageQuota: jest.fn().mockResolvedValue({ allowed: true, available: 999_999 }),
          },
        },
        { provide: DocumentService, useValue: { generateSasUrl: jest.fn().mockResolvedValue('https://example/upload') } },
        { provide: NotificationsService, useValue: {} },
        { provide: IndexingService, useValue: {} },
        { provide: UrlToPdfClientService, useValue: { convert: jest.fn() } },
        { provide: WebsiteCrawlerService, useValue: { crawl: jest.fn() } },
        {
          provide: ConfigService,
          useValue: { get: (_: string, dflt?: unknown) => dflt },
        },
        {
          provide: WorkspaceUploadSettingsService,
          useValue: {
            getAllowedExtensions,
            getAllowedMimeTypesForExtension: jest.fn((ext: string) => {
              const map: Record<string, string> = {
                '.pdf': 'application/pdf',
                '.png': 'image/png',
                '.exe': 'application/octet-stream',
              };
              return map[ext] ? [map[ext]] : [];
            }),
            ensureDefaultSettings: jest.fn().mockResolvedValue(undefined),
            getSettings: jest.fn().mockResolvedValue({ allowedExtensions: ['.pdf', '.png'] }),
          },
        },
        {
          provide: LoggerService,
          useValue: {
            setContext: jest.fn(),
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
          },
        },
      ],
    }).compile();

    svc = mod.get(WorkspaceDocumentService);
  });

  it('accepts a file whose extension is allowed and whose MIME matches', async () => {
    await expect(
      svc.requestUploadUrl(WS_ID, USER_ID, {
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1024,
      }),
    ).resolves.toBeDefined();
  });

  it('rejects a file with a non-allowed extension', async () => {
    await expect(
      svc.requestUploadUrl(WS_ID, USER_ID, {
        filename: 'malware.exe',
        mimeType: 'application/octet-stream',
        size: 1024,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a file whose extension is allowed but MIME does not match', async () => {
    await expect(
      svc.requestUploadUrl(WS_ID, USER_ID, {
        filename: 'report.pdf',
        mimeType: 'image/png',
        size: 1024,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('WorkspaceDocumentService.mapToResponse', () => {
  let svc: WorkspaceDocumentService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        WorkspaceDocumentService,
        { provide: getModelToken(WorkspaceDoc.name), useValue: {} },
        { provide: getModelToken(UploadSession.name), useValue: {} },
        {
          provide: WorkspaceService,
          useValue: {
            findById: jest.fn().mockResolvedValue({
              id: WS_ID,
              createdBy: USER_ID,
            }),
          },
        },
        { provide: DocumentService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: IndexingService, useValue: {} },
        { provide: UrlToPdfClientService, useValue: { convert: jest.fn() } },
        { provide: WebsiteCrawlerService, useValue: { crawl: jest.fn() } },
        {
          provide: ConfigService,
          useValue: { get: (_: string, dflt?: unknown) => dflt },
        },
        {
          provide: WorkspaceUploadSettingsService,
          useValue: {
            getAllowedExtensions: jest.fn().mockResolvedValue([...DEFAULT_WORKSPACE_UPLOAD_EXTENSIONS]),
            getAllowedMimeTypesForExtension: jest.fn(() => []),
            ensureDefaultSettings: jest.fn().mockResolvedValue(undefined),
            getSettings: jest.fn().mockResolvedValue({ allowedExtensions: [...DEFAULT_WORKSPACE_UPLOAD_EXTENSIONS] }),
          },
        },
        {
          provide: LoggerService,
          useValue: {
            setContext: jest.fn(),
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
          },
        },
      ],
    }).compile();

    svc = mod.get(WorkspaceDocumentService);
  });

  it('defaults mapToResponse.type to "doc" for legacy documents', () => {
    // mapToResponse is private; call via any-cast on the service instance.
    const doc: any = {
      _id: { toString: () => 'id1' },
      originalName: 'a.pdf',
      mimeType: 'application/pdf',
      size: 1,
      workspaceId: { toString: () => 'ws1' },
      createdBy: { toString: () => 'u1' },
      status: 'completed',
      indexingStatus: 'ready',
      isFolder: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const res = (svc as any).mapToResponse(doc);
    expect(res.type).toBe('doc');
    expect(res.sourceUrl).toBeUndefined();
  });
});

describe('WorkspaceDocumentService url document (addLink)', () => {
  let service: WorkspaceDocumentService;
  let documentModel: { create: jest.Mock; findByIdAndUpdate: jest.Mock };
  let workspaceService: {
    getStorageContext: jest.Mock;
    checkStorageQuota: jest.Mock;
    updateStorageUsage: jest.Mock;
  };
  let indexingService: { queueDocument: jest.Mock; sendIndexingStatusNotification: jest.Mock };
  let urlToPdfClient: { convert: jest.Mock };
  let documentService: { upload: jest.Mock };

  beforeEach(async () => {
    documentModel = {
      create: jest.fn().mockResolvedValue({}),
      findByIdAndUpdate: jest.fn().mockResolvedValue({}),
    };
    workspaceService = {
      getStorageContext: jest.fn().mockResolvedValue({ ownerUserId: USER_ID, storagePrefix: 'ws' }),
      checkStorageQuota: jest.fn().mockResolvedValue({ allowed: true, available: 999_999 }),
      updateStorageUsage: jest.fn().mockResolvedValue(undefined),
    };
    indexingService = {
      queueDocument: jest.fn().mockResolvedValue(undefined),
      sendIndexingStatusNotification: jest.fn().mockResolvedValue(undefined),
    };
    urlToPdfClient = { convert: jest.fn() };
    documentService = { upload: jest.fn() };

    const mod = await Test.createTestingModule({
      providers: [
        WorkspaceDocumentService,
        { provide: getModelToken(WorkspaceDoc.name), useValue: documentModel },
        { provide: getModelToken(UploadSession.name), useValue: {} },
        { provide: WorkspaceService, useValue: workspaceService },
        { provide: DocumentService, useValue: documentService },
        { provide: NotificationsService, useValue: {} },
        { provide: IndexingService, useValue: indexingService },
        { provide: UrlToPdfClientService, useValue: urlToPdfClient },
        { provide: WebsiteCrawlerService, useValue: { crawl: jest.fn() } },
        {
          provide: ConfigService,
          useValue: { get: (_: string, dflt?: unknown) => dflt },
        },
        {
          provide: WorkspaceUploadSettingsService,
          useValue: {
            getAllowedExtensions: jest.fn().mockResolvedValue([...DEFAULT_WORKSPACE_UPLOAD_EXTENSIONS]),
            getAllowedMimeTypesForExtension: jest.fn(() => []),
            ensureDefaultSettings: jest.fn().mockResolvedValue(undefined),
            getSettings: jest.fn().mockResolvedValue({ allowedExtensions: [...DEFAULT_WORKSPACE_UPLOAD_EXTENSIONS] }),
          },
        },
        {
          provide: LoggerService,
          useValue: {
            setContext: jest.fn(),
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
          },
        },
      ],
    }).compile();

    service = mod.get(WorkspaceDocumentService);
  });

  it('derives a sanitized .pdf filename from a URL', () => {
    const d = (service as any).deriveFilenameFromUrl.bind(service);
    expect(d('https://www.example.com/docs/guide/')).toBe('example.com-docs-guide.pdf');
    expect(d('https://example.com')).toBe('example.com.pdf');
    expect(d('not a url')).toBe('website.pdf');
  });

  it('addLink creates a processing url document and returns it', async () => {
    (service as any).resolveUniqueOriginalName = jest.fn().mockResolvedValue('example.com.pdf');
    const created = {
      _id: { toString: () => 'doc1' },
      originalName: 'example.com.pdf',
      mimeType: 'application/pdf',
      size: 0,
      type: 'url',
      sourceUrl: 'https://example.com',
      workspaceId: { toString: () => 'ws1' },
      createdBy: { toString: () => 'u1' },
      status: 'processing',
      indexingStatus: 'none',
      isFolder: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    documentModel.create.mockResolvedValue(created);
    // Prevent the fire-and-forget conversion from doing real work in this test.
    (service as any).convertAndStore = jest.fn().mockResolvedValue(undefined);

    const res = await service.addLink(WS_ID, USER_ID, 'https://example.com');
    expect(res.type).toBe('url');
    expect(res.status).toBe('processing');
    expect(res.sourceUrl).toBe('https://example.com');
    expect((service as any).convertAndStore).toHaveBeenCalled();
  });

  it('addLink inserts a unique non-null path to satisfy the unique path index', async () => {
    // The workspace_documents collection has a unique index on `path`; a doc
    // inserted with path=null collides with any other null-path doc (E11000).
    // Link docs have no blob yet at creation, so addLink must assign a unique
    // placeholder path (mirroring the folder-creation pattern) that
    // convertAndStore later overwrites with the real blob path.
    (service as any).resolveUniqueOriginalName = jest.fn().mockResolvedValue('example.com.pdf');
    documentModel.create.mockResolvedValue({
      _id: { toString: () => 'doc1' },
      originalName: 'example.com.pdf',
      mimeType: 'application/pdf',
      size: 0,
      type: 'url',
      sourceUrl: 'https://example.com',
      workspaceId: { toString: () => 'ws1' },
      createdBy: { toString: () => 'u1' },
      status: 'processing',
      indexingStatus: 'none',
      isFolder: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (service as any).convertAndStore = jest.fn().mockResolvedValue(undefined);

    await service.addLink(WS_ID, USER_ID, 'https://example.com');

    const createArg = documentModel.create.mock.calls[0][0];
    expect(typeof createArg.path).toBe('string');
    expect(createArg.path).toContain('link-pending:');
    // Placeholder must embed the doc's own id so concurrent link adds never collide.
    expect(createArg.path).toContain(createArg._id.toString());
  });

  it('addLinks creates one processing url doc per URL with a unique path', async () => {
    (service as any).resolveUniqueOriginalName = jest.fn(async (_ws, name) => name);
    (service as any).convertAndStore = jest.fn().mockResolvedValue(undefined);
    const created: any[] = [];
    (documentModel.create as jest.Mock).mockImplementation(async (doc: any) => {
      const d = { ...doc, _id: { toString: () => String(created.length + 1) },
        workspaceId: { toString: () => 'ws1' }, createdBy: { toString: () => 'u1' },
        createdAt: new Date(), updatedAt: new Date() };
      created.push(d);
      return d;
    });

    const res = await service.addLinks(WS_ID, USER_ID, ['https://a.com/x', 'https://b.com/y']);
    expect(res).toHaveLength(2);
    expect(created).toHaveLength(2);
    // Each doc gets a unique link-pending path.
    const paths = created.map((d) => d.path);
    expect(new Set(paths).size).toBe(2);
    paths.forEach((p) => expect(p).toContain('link-pending:'));
    expect((service as any).convertAndStore).toHaveBeenCalledTimes(2);
  });
});

describe('WorkspaceDocumentService SSRF guard (assertUrlIsSafe / checkUrlReachable)', () => {
  let service: WorkspaceDocumentService;
  const mockLookup = lookup as jest.MockedFunction<typeof lookup>;

  beforeEach(async () => {
    mockLookup.mockReset();

    const mod = await Test.createTestingModule({
      providers: [
        WorkspaceDocumentService,
        { provide: getModelToken(WorkspaceDoc.name), useValue: {} },
        { provide: getModelToken(UploadSession.name), useValue: {} },
        { provide: WorkspaceService, useValue: {} },
        { provide: DocumentService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: IndexingService, useValue: {} },
        { provide: UrlToPdfClientService, useValue: { convert: jest.fn() } },
        { provide: WebsiteCrawlerService, useValue: { crawl: jest.fn() } },
        {
          provide: ConfigService,
          useValue: { get: (_: string, dflt?: unknown) => dflt },
        },
        {
          provide: WorkspaceUploadSettingsService,
          useValue: {
            getAllowedExtensions: jest.fn().mockResolvedValue([...DEFAULT_WORKSPACE_UPLOAD_EXTENSIONS]),
            getAllowedMimeTypesForExtension: jest.fn(() => []),
            ensureDefaultSettings: jest.fn().mockResolvedValue(undefined),
            getSettings: jest.fn().mockResolvedValue({ allowedExtensions: [...DEFAULT_WORKSPACE_UPLOAD_EXTENSIONS] }),
          },
        },
        {
          provide: LoggerService,
          useValue: {
            setContext: jest.fn(),
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
          },
        },
      ],
    }).compile();

    service = mod.get(WorkspaceDocumentService);
  });

  const assertUrlIsSafe = (url: string): Promise<void> =>
    (service as any).assertUrlIsSafe(url);

  it('rejects a localhost URL without consulting DNS', async () => {
    await expect(assertUrlIsSafe('http://localhost:8080/admin')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('rejects an IPv4 loopback literal (127.0.0.1)', async () => {
    mockLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as any);
    await expect(assertUrlIsSafe('http://127.0.0.1/secret')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects the cloud metadata address (169.254.169.254)', async () => {
    mockLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as any);
    await expect(
      assertUrlIsSafe('http://169.254.169.254/latest/meta-data/'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a hostname that DNS-resolves to a private address', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }] as any);
    await expect(assertUrlIsSafe('http://internal.example.com/')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a non-http(s) protocol', async () => {
    await expect(assertUrlIsSafe('file:///etc/passwd')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('allows a normal public host that resolves to a public address', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);
    await expect(assertUrlIsSafe('https://example.com/docs')).resolves.toBeUndefined();
  });

  it('checkUrlReachable propagates the SSRF guard as a thrown BadRequestException', async () => {
    await expect(service.checkUrlReachable('http://localhost/')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('checkUrlReachable does not follow a redirect to a private host (redirect SSRF guard)', async () => {
    const mockedAxios = axios as jest.Mocked<typeof axios>;
    mockedAxios.head.mockReset();
    mockedAxios.get.mockReset();

    // Initial seed URL is public; the redirect target is a private host.
    mockLookup.mockImplementation((hostname: unknown) => {
      if (hostname === 'internal.example.com') {
        return Promise.resolve([{ address: '10.0.0.5', family: 4 }] as any);
      }
      return Promise.resolve([{ address: '93.184.216.34', family: 4 }] as any);
    });

    mockedAxios.head.mockResolvedValue({
      status: 302,
      headers: { location: 'http://internal.example.com/secret' },
    } as any);

    const result = await service.checkUrlReachable('https://public.example.com/');

    expect(result).toEqual(
      expect.objectContaining({ reachable: false }),
    );
    // The GET fallback must never reach the disallowed redirect target.
    expect(mockedAxios.get).not.toHaveBeenCalledWith(
      'http://internal.example.com/secret',
      expect.anything(),
    );
  });
});
