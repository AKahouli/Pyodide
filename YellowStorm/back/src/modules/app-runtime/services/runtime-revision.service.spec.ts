import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { DocumentService } from '@modules/document/document.service';
import {
  STARTER_REACT_VITE_V1_FILES,
  STARTER_REACT_VITE_V1_REVISION_ID,
} from '../constants/starter-react-vite-v1';
import { AppSourceRevision } from '../schemas/app-source-revision.schema';
import { RuntimeRevisionService } from './runtime-revision.service';

describe('RuntimeRevisionService', () => {
  let svc: RuntimeRevisionService;

  const findOne = jest.fn();
  const create = jest.fn();
  const download = jest.fn();

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
    findOne.mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve(null) }),
    });
    create.mockResolvedValue({});
    download.mockRejectedValue(new Error('ceph offline'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RuntimeRevisionService,
        {
          provide: getModelToken(AppSourceRevision.name),
          useValue: { findOne, create },
        },
        { provide: DocumentService, useValue: { download } },
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
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'sess_1',
        revisionId: STARTER_REACT_VITE_V1_REVISION_ID,
        files: expect.any(Array),
      }),
    );

    findOne.mockReturnValueOnce({
      lean: () => ({
        exec: () =>
          Promise.resolve({
            workspaceId: 'sess_1',
            revisionId: STARTER_REACT_VITE_V1_REVISION_ID,
            parentRevisionId: null,
            manifestHash: 'abc',
            manifestObjectKey: 'appbuilder/manifests/_system/starter_react_vite_v1.json',
            files: [...STARTER_REACT_VITE_V1_FILES],
          }),
      }),
    });

    create.mockClear();
    const second = await svc.ensureStarterRevision('sess_1');
    expect(create).not.toHaveBeenCalled();
    expect(second.workspaceId).toBe('sess_1');
  });
});
