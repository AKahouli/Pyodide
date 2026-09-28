import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { DocumentService } from '@modules/document/document.service';
import {
  STARTER_REACT_VITE_V1_FILES,
  STARTER_REACT_VITE_V1_REVISION_ID,
} from '../constants/starter-react-vite-v1';
import { type RuntimeSourceRevisionStore } from '../persistence/runtime-source-revision.store';
import { RuntimeRevisionService } from './runtime-revision.service';
import { PgRuntimeSourceRevisionStore } from '../persistence/pg-runtime-source-revision.store';

describe('RuntimeRevisionService', () => {
  let svc: RuntimeRevisionService;

  const findByWorkspaceAndRevision = jest.fn();
  const existsByWorkspaceAndRevision = jest.fn();
  const createIfNotExists = jest.fn();
  const listRevisionIds = jest.fn();
  const download = jest.fn();
  const exists = jest.fn();
  const upload = jest.fn();

  const store: RuntimeSourceRevisionStore = {
    findByWorkspaceAndRevision,
    existsByWorkspaceAndRevision,
    createIfNotExists,
    listRevisionIds,
  };

  const config = {
    get: jest.fn((key: string) => {
      if (key === 'appRuntime.starterRevisionId') return STARTER_REACT_VITE_V1_REVISION_ID;
      if (key === 'appRuntime.starterManifestKey') {
        return 'appbuilder/manifests/_system/starter_react_vite_v1.json';
      }
      return undefined;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    findByWorkspaceAndRevision.mockResolvedValue(null);
    existsByWorkspaceAndRevision.mockResolvedValue(false);
    createIfNotExists.mockImplementation(async (data) => ({
      id: 'generated_id',
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    listRevisionIds.mockResolvedValue([]);
    download.mockRejectedValue(new Error('ceph offline'));
    exists.mockResolvedValue(true);
    upload.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RuntimeRevisionService,
        {
          provide: PgRuntimeSourceRevisionStore,
          useValue: store,
        },
        { provide: DocumentService, useValue: { download, exists, upload } },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    svc = module.get(RuntimeRevisionService);
    svc.clearStarterCache();
  });

  it('falls back to the embedded Ceph starter file list when download fails', async () => {
    const starter = await svc.getStarterManifest();

    expect(starter.revisionId).toBe(STARTER_REACT_VITE_V1_REVISION_ID);
    expect(starter.files).toHaveLength(STARTER_REACT_VITE_V1_FILES.length);
    expect(starter.files.map((f) => f.path)).toEqual(
      STARTER_REACT_VITE_V1_FILES.map((f) => f.path),
    );
    expect(starter.files[0].objectKey).toBe(STARTER_REACT_VITE_V1_FILES[0].objectKey);
  });

  it('loads the starter manifest from Ceph when available', async () => {
    const payload = {
      revisionId: STARTER_REACT_VITE_V1_REVISION_ID,
      parentRevisionId: null,
      files: [...STARTER_REACT_VITE_V1_FILES],
    };
    download.mockResolvedValueOnce(Buffer.from(JSON.stringify(payload), 'utf8'));

    const starter = await svc.getStarterManifest();

    expect(download).toHaveBeenCalledWith(
      'appbuilder/manifests/_system/starter_react_vite_v1.json',
    );
    expect(starter.files).toHaveLength(6);
    expect(starter.manifestObjectKey).toContain('starter_react_vite_v1.json');
  });

  it('authorizes the global starter for any workspace', async () => {
    const revision = await svc.getAuthorizedRevision('sess_1', STARTER_REACT_VITE_V1_REVISION_ID);
    expect(revision.revisionId).toBe(STARTER_REACT_VITE_V1_REVISION_ID);
  });

  it('rejects unknown workspace revisions', async () => {
    await expect(svc.getAuthorizedRevision('sess_1', 'rev_missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('resolves object keys only from the revision manifest', async () => {
    const revision = await svc.getStarterManifest();
    const items = svc.resolveObjectKeys(revision, ['src/App.jsx', 'package.json']);

    expect(items).toEqual([
      expect.objectContaining({
        path: 'src/App.jsx',
        objectKey: STARTER_REACT_VITE_V1_FILES.find((f) => f.path === 'src/App.jsx')!.objectKey,
      }),
      expect.objectContaining({
        path: 'package.json',
        objectKey: STARTER_REACT_VITE_V1_FILES[0].objectKey,
      }),
    ]);
  });

  it('rejects path traversal and unknown paths', async () => {
    const revision = await svc.getStarterManifest();

    expect(() => svc.resolveObjectKeys(revision, ['../secret'])).toThrow(BadRequestException);
    expect(() => svc.resolveObjectKeys(revision, ['not-in-manifest.ts'])).toThrow(
      NotFoundException,
    );
  });

  it('ensureStarterRevision upserts a workspace row idempotently', async () => {
    await svc.ensureStarterRevision('sess_1');
    expect(createIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'sess_1',
        revisionId: STARTER_REACT_VITE_V1_REVISION_ID,
        files: expect.any(Array),
      }),
    );

    findByWorkspaceAndRevision.mockResolvedValueOnce({
      id: 'existing_id',
      workspaceId: 'sess_1',
      revisionId: STARTER_REACT_VITE_V1_REVISION_ID,
      parentRevisionId: null,
      manifestHash: 'abc',
      manifestObjectKey: 'appbuilder/manifests/_system/starter_react_vite_v1.json',
      files: [...STARTER_REACT_VITE_V1_FILES],
      createdByToolCallId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    createIfNotExists.mockClear();
    const second = await svc.ensureStarterRevision('sess_1');
    expect(createIfNotExists).not.toHaveBeenCalled();
    expect(second.workspaceId).toBe('sess_1');
  });

  it('branchRevision mints an id above every persisted revision and copies the manifest', async () => {
    const rev2Doc = {
      id: 'some_id',
      workspaceId: 'sess_1',
      revisionId: 'rev_2',
      parentRevisionId: null,
      manifestHash: 'hash_2',
      manifestObjectKey: 'appbuilder/manifests/sess_1/rev_2.json',
      files: [
        { path: 'src/main.jsx', sha256: 'a'.repeat(64), objectKey: 'blobs/aaa', size: 10 },
        { path: 'index.html', sha256: 'b'.repeat(64), objectKey: 'blobs/bbb', size: 5 },
      ],
      createdByToolCallId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    findByWorkspaceAndRevision.mockResolvedValue(rev2Doc);
    listRevisionIds.mockResolvedValue(['rev_2', 'rev_7', 'rev_legacy']);

    const branch = await svc.branchRevision('sess_1', 'rev_2');

    expect(branch.revisionId).toBe('rev_8');
    expect(branch.parentRevisionId).toBe('rev_2');
    expect(branch.files.map((f) => f.path)).toEqual(['index.html', 'src/main.jsx']);
    expect(upload).toHaveBeenCalledWith(
      expect.any(Buffer),
      'rev_8.json',
      'application/json',
      { generateUniqueName: false, customFileName: 'appbuilder/manifests/sess_1/rev_8.json' },
    );
    expect(createIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'sess_1',
        revisionId: 'rev_8',
        parentRevisionId: 'rev_2',
      }),
    );
  });

  it('branchRevision rejects an unknown source revision', async () => {
    findByWorkspaceAndRevision.mockResolvedValue(null);
    await expect(svc.branchRevision('sess_1', 'rev_missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
