import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { lookup } from 'dns/promises';
import axios from 'axios';
import { Types } from 'mongoose';
import { WorkspaceDocumentService } from './workspace-document.service';
import { BadRequestException } from '../exceptions';
import * as urlSafetyModule from './services/url-safety';

jest.mock('dns/promises');
jest.mock('axios');
import { WorkspaceDoc, DocumentStatus } from './schemas/workspace-document.schema';
import { UploadSession } from './schemas/upload-session.schema';
import { WorkspaceService } from './workspace.service';
import { DocumentService } from '../document/document.service';
import { NotificationsService } from '../notifications/notifications.service';
import { IndexingService } from '../indexing/indexing.service';
import { UrlToPdfClientService } from './services/url-to-pdf-client.service';
import { LoggerService } from '../logger';
import { WorkspaceUploadSettingsService } from '../system/workspace-upload-settings.service';
import { WorkspaceArtifactCleanupService } from './services/workspace-artifact-cleanup.service';
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
  let documentModel: { create: jest.Mock; findByIdAndUpdate: jest.Mock; exists: jest.Mock };
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
      // Echo the create() argument back (it already carries a real ObjectId
      // _id/workspaceId/createdBy set by the service), so mapToResponse()
      // has real values to read instead of crashing on an empty object.
      // A real Mongoose model stamps createdAt/updatedAt on insert; fill
      // those in here since this plain-object mock doesn't.
      create: jest.fn().mockImplementation(async (doc: any) => ({
        createdAt: new Date(),
        updatedAt: new Date(),
        ...doc,
      })),
      findByIdAndUpdate: jest.fn().mockResolvedValue({}),
      exists: jest.fn().mockReturnValue({ lean: () => Promise.resolve(null) }),
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
        {
          provide: ConfigService,
          // addLinks reads 'indexing.sequentialDelayMs' directly (no default
          // arg passed at the call site); keep it at 0 here so the
          // fire-and-forget sequential loop doesn't wait on a real timer
          // between items in these tests. Other keys keep the old
          // "return whatever default the caller passed" behavior.
          useValue: {
            get: (key: string, dflt?: unknown) =>
              key === 'indexing.sequentialDelayMs' ? 0 : dflt,
          },
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
        { provide: WorkspaceArtifactCleanupService, useValue: {} },
      ],
    }).compile();

    service = mod.get(WorkspaceDocumentService);
  });

  it('derives a page-name .pdf filename from a URL', () => {
    const d = (service as any).deriveFilenameFromUrl.bind(service);
    // Last path segment only (the "page name"), not the full URL.
    expect(d('https://www.example.com/docs/guide/')).toBe('guide.pdf');
    expect(d('https://example.com/page/pagename')).toBe('pagename.pdf');
    // No path segments -> fall back to host.
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

    // Conversion is now a strictly sequential, fire-and-forget loop: the
    // second item's convertAndStore call only happens after the first
    // item's mocked call resolves (a microtask hop beyond addLinks
    // returning), so flush pending microtasks before asserting both ran.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((service as any).convertAndStore).toHaveBeenCalledTimes(2);
  });

  it('addLinks persists sourceRootUrl and its normalized form in metadata', async () => {
    (service as any).convertAndStore = jest.fn().mockResolvedValue(undefined);
    await service.addLinks(WS_ID, USER_ID, ['https://a.com/x'], { sourceRootUrl: 'https://a.com/services' });
    const createArg = documentModel.create.mock.calls[0][0];
    expect(createArg.metadata.sourceRootUrl).toBe('https://a.com/services');
    expect(createArg.metadata.normalizedSourceRootUrl).toBe('https://a.com/services');
  });

  it('addLinks omits sourceRootUrl metadata when none is provided', async () => {
    (service as any).convertAndStore = jest.fn().mockResolvedValue(undefined);
    await service.addLinks(WS_ID, USER_ID, ['https://a.com/x']);
    const createArg = documentModel.create.mock.calls[0][0];
    expect(createArg.metadata.sourceRootUrl).toBeUndefined();
  });

  it('addLinks names the document from the provided link text when present', async () => {
    (service as any).convertAndStore = jest.fn().mockResolvedValue(undefined);
    await service.addLinks(WS_ID, USER_ID, ['https://a.com/services'], {
      names: { 'https://a.com/services': '  Our   Services  ' },
    });
    const createArg = documentModel.create.mock.calls[0][0];
    expect(createArg.originalName).toBe('Our Services');
  });

  it('addLinks falls back to the url-derived name when no link text is provided', async () => {
    (service as any).convertAndStore = jest.fn().mockResolvedValue(undefined);
    await service.addLinks(WS_ID, USER_ID, ['https://a.com/services']);
    const createArg = documentModel.create.mock.calls[0][0];
    expect(createArg.originalName).toBe('services.pdf');
  });

  it('addLinks roots a manual link to its own url via the roots override', async () => {
    (service as any).convertAndStore = jest.fn().mockResolvedValue(undefined);
    await service.addLinks(WS_ID, USER_ID, ['https://a.com/x', 'https://manual.org/p'], {
      sourceRootUrl: 'https://a.com/services',
      roots: { 'https://manual.org/p': 'https://manual.org/p' },
    });
    const first = documentModel.create.mock.calls[0][0];
    const second = documentModel.create.mock.calls[1][0];
    expect(first.metadata.sourceRootUrl).toBe('https://a.com/services'); // session root
    expect(second.metadata.sourceRootUrl).toBe('https://manual.org/p'); // self-rooted
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

  it('checkUrlReachable sends a descriptive User-Agent header (not axios default)', async () => {
    const mockedAxios = axios as jest.Mocked<typeof axios>;
    mockedAxios.head.mockReset();
    mockedAxios.get.mockReset();

    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);
    mockedAxios.head.mockResolvedValue({ status: 200, headers: {} } as any);

    const result = await service.checkUrlReachable('https://public.example.com/');

    expect(result).toEqual(expect.objectContaining({ reachable: true }));
    expect(mockedAxios.head).toHaveBeenCalledTimes(1);
    const [, headOpts] = mockedAxios.head.mock.calls[0];
    const userAgent = (headOpts as { headers?: Record<string, string> })?.headers?.['User-Agent'];
    expect(userAgent).toEqual(expect.any(String));
    expect(userAgent?.length).toBeGreaterThan(0);
    expect(userAgent).not.toMatch(/^axios\//);
  });
});

describe('WorkspaceDocumentService.addLinks sequencing', () => {
  let service: WorkspaceDocumentService;
  let documentModel: { create: jest.Mock; findByIdAndUpdate: jest.Mock };
  let workspaceService: {
    checkStorageQuota: jest.Mock;
    getStorageContext: jest.Mock;
    updateStorageUsage: jest.Mock;
  };
  let indexingService: { queueDocument: jest.Mock; sendIndexingStatusNotification: jest.Mock };
  let documentService: { upload: jest.Mock };
  let urlSafeSpy: jest.SpyInstance;
  let order: string[];
  let events: string[];
  let convert: jest.Mock;

  beforeEach(async () => {
    // convertAndStore (called from the fire-and-forget loop) runs the real
    // assertUrlIsSafe guard, which does a live DNS lookup. Test URLs like
    // https://a.example won't resolve, so convert() would never be reached
    // and the ordering assertion below would fail for the wrong reason.
    // Stub the guard just for this describe block. TS compiles the named
    // import in workspace-document.service.ts ("import { assertUrlIsSafe }
    // from './services/url-safety'") to a property access on the required
    // module object at each call site (commonjs target), so spying on the
    // module's export here is visible to the service without a jest.mock()
    // that would affect the SSRF-guard describe block above, which needs
    // the real implementation.
    urlSafeSpy = jest.spyOn(urlSafetyModule, 'assertUrlIsSafe').mockResolvedValue(undefined);

    order = [];
    events = [];
    convert = jest.fn(async (url: string) => {
      order.push(url);
      events.push(`convert:${url}`);
      return Buffer.from('pdf');
    });

    let createCount = 0;
    documentModel = {
      create: jest.fn(async (doc: any) => {
        createCount += 1;
        return {
          ...doc,
          _id: { toString: () => `doc${createCount}` },
          workspaceId: { toString: () => 'ws1' },
          createdBy: { toString: () => 'u1' },
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }),
      // findByIdAndUpdate with a COMPLETED/FAILED status is the last step of
      // one item's whole convertAndStore pipeline; recording it (alongside
      // convert start, above) lets the test tell "strictly sequential" apart
      // from "started concurrently but happened to call convert() in input
      // order" — the latter is exactly what the old bounded-concurrency
      // fan-out produces with fast, same-speed mocks.
      findByIdAndUpdate: jest.fn(async (documentId: string) => {
        events.push(`update:${documentId}`);
        return {};
      }),
    };
    workspaceService = {
      checkStorageQuota: jest.fn().mockResolvedValue({ allowed: true, available: 999_999 }),
      getStorageContext: jest.fn().mockResolvedValue({ ownerUserId: USER_ID, storagePrefix: 'ws' }),
      updateStorageUsage: jest.fn().mockResolvedValue(undefined),
    };
    indexingService = {
      queueDocument: jest.fn().mockResolvedValue(undefined),
      sendIndexingStatusNotification: jest.fn().mockResolvedValue(undefined),
    };
    documentService = {
      upload: jest.fn().mockResolvedValue({
        storedName: 'stored.pdf',
        blobPath: 'blob/stored.pdf',
        url: 'https://blob/stored.pdf',
        contentHash: 'hash',
      }),
    };

    const mod = await Test.createTestingModule({
      providers: [
        WorkspaceDocumentService,
        { provide: getModelToken(WorkspaceDoc.name), useValue: documentModel },
        { provide: getModelToken(UploadSession.name), useValue: {} },
        { provide: WorkspaceService, useValue: workspaceService },
        { provide: DocumentService, useValue: documentService },
        { provide: NotificationsService, useValue: {} },
        { provide: IndexingService, useValue: indexingService },
        { provide: UrlToPdfClientService, useValue: { convert } },
        {
          provide: ConfigService,
          useValue: {
            // Real addLinks reads the dotted key 'indexing.sequentialDelayMs'
            // directly; sequentialDelayMs: 0 keeps the test from waiting on
            // a real inter-item delay.
            get: (key: string) => (key === 'indexing.sequentialDelayMs' ? 0 : undefined),
          },
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
    // Real resolveUniqueOriginalName issues a documentModel.exists(...).lean()
    // query; stub it out (mirroring the existing addLinks tests above) since
    // uniqueness resolution isn't what this test is about.
    (service as any).resolveUniqueOriginalName = jest.fn(async (_ws: string, name: string) => name);
  });

  afterEach(() => {
    urlSafeSpy.mockRestore();
  });

  it('converts URLs strictly one at a time, in order', async () => {
    const responses = await service.addLinks(WS_ID, USER_ID, [
      'https://a.example',
      'https://b.example',
    ]);

    // Conversion is fire-and-forget; flush pending microtasks before asserting.
    // The whole per-item chain (guard -> convert -> quota -> upload -> DB
    // update -> usage -> indexing) is a pure microtask chain when the delay
    // is 0, and Node drains the microtask queue fully before a timer macro-
    // task runs, so one setTimeout(0) flush covers both items.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(order).toEqual(['https://a.example', 'https://b.example']);
    expect(convert).toHaveBeenCalledTimes(2);

    // Strict sequencing: item 2's convert() must not fire until item 1's
    // whole pipeline (through its final findByIdAndUpdate) has completed.
    // A concurrency-capped fan-out with >1 worker starts both items' first
    // await essentially at once, so with fast same-speed mocks it still
    // calls convert() in input order (asserted above) but does NOT wait for
    // item 1's update before starting item 2 -- this interleaving is what
    // distinguishes the old scheduling from the new one.
    expect(events).toEqual([
      `convert:${responses[0].sourceUrl}`,
      `update:${responses[0].id}`,
      `convert:${responses[1].sourceUrl}`,
      `update:${responses[1].id}`,
    ]);
  });

  it('does not stop subsequent conversions when an earlier one fails', async () => {
    convert.mockImplementationOnce(async (url: string) => {
      order.push(url);
      throw new Error('conversion failed');
    });

    await service.addLinks(WS_ID, USER_ID, ['https://a.example', 'https://b.example']);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(order).toEqual(['https://a.example', 'https://b.example']);
    expect(convert).toHaveBeenCalledTimes(2);
  });
});
