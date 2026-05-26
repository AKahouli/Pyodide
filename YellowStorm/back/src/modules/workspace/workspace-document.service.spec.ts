import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { WorkspaceDocumentService } from './workspace-document.service';
import { WorkspaceDoc, DocumentStatus } from './schemas/workspace-document.schema';
import { UploadSession } from './schemas/upload-session.schema';
import { WorkspaceService } from './workspace.service';
import { DocumentService } from '../document/document.service';
import { NotificationsService } from '../notifications/notifications.service';
import { IndexingService } from '../indexing/indexing.service';
import { LoggerService } from '../logger';

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
