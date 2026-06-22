import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { WorkspaceDocumentService } from './workspace-document.service';
import { BadRequestException } from '../exceptions';
import { WorkspaceDoc, DocumentStatus } from './schemas/workspace-document.schema';
import { UploadSession } from './schemas/upload-session.schema';
import { WorkspaceService } from './workspace.service';
import { DocumentService } from '../document/document.service';
import { NotificationsService } from '../notifications/notifications.service';
import { IndexingService } from '../indexing/indexing.service';
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
