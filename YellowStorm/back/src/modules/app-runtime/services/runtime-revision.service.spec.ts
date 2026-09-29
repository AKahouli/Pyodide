import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { DocumentService } from '@modules/document/document.service';
import {
  STARTER_REACT_VITE_V1_FILES,
  STARTER_REACT_VITE_V1_REVISION_ID,
} from '../constants/starter-react-vite-v1';
import { type RuntimeSourceRevisionStore } from '../persistence/runtime-source-revision.store';
import {
  CONVERSATION_V2_TEMPLATE_STORE,
  type ConversationV2TemplateStore,
} from '@modules/conversation-v2/persistence/conversation-v2-template.store';
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

  const findByRevisionId = jest.fn();
  const findRevisionByRevisionId = jest.fn();
  const templateStore = {
    findByRevisionId,
    findRevisionByRevisionId,
  } as unknown as ConversationV2TemplateStore;

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
    findByRevisionId.mockResolvedValue(null);
    findRevisionByRevisionId.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RuntimeRevisionService,
        {
          provide: PgRuntimeSourceRevisionStore,
          useValue: store,
        },
        { provide: DocumentService, useValue: { download, exists, upload } },
        { provide: ConfigService, useValue: config },
        { provide: CONVERSATION_V2_TEMPLATE_STORE, useValue: templateStore },
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

  it('seeds the workspace with the bound template manifest instead of the starter', async () => {
    const files = [
      { path: 'package.json', sha256: 'a'.repeat(64), objectKey: 'blobs/template', size: 5 },
    ];
    findRevisionByRevisionId.mockResolvedValueOnce({
      revisionId: 'template_tpl_1',
      manifestObjectKey: 'appbuilder/manifests/_system/template_tpl_1.json',
      manifestHash: 'template-hash',
      files,
    });

    const revision = await svc.ensureWorkspaceRevision('sess_1', 'template_tpl_1');

    expect(revision.revisionId).toBe('template_tpl_1');
    expect(createIfNotExists).toHaveBeenCalledWith({
      revisionId: 'template_tpl_1',
      workspaceId: 'sess_1',
      parentRevisionId: null,
      manifestHash: 'template-hash',
      manifestObjectKey: 'appbuilder/manifests/_system/template_tpl_1.json',
      files,
      createdByToolCallId: null,
    });
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

  it('commitWorkspaceRevision inherits non-text parent assets when presentPaths lists them', async () => {
    const parentFiles = [
      {
        path: 'package.json',
        sha256: 'a'.repeat(64),
        objectKey: 'appbuilder/blobs/sha256/aa/aaa',
        size: 2,
      },
      {
        path: 'src/assets/hero.png',
        sha256: 'b'.repeat(64),
        objectKey: 'appbuilder/blobs/sha256/bb/bbb',
        size: 4,
      },
    ];
    findByWorkspaceAndRevision.mockImplementation(async (_ws: string, revisionId: string) => {
      if (revisionId === 'rev_1') {
        return {
          id: 'parent_id',
          workspaceId: 'ws_1',
          revisionId: 'rev_1',
          parentRevisionId: null,
          manifestHash: 'hash_1',
          manifestObjectKey: 'appbuilder/manifests/ws_1/rev_1.json',
          files: parentFiles,
          createdByToolCallId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
      return null;
    });
    existsByWorkspaceAndRevision.mockResolvedValue(true);

    const committed = await svc.commitWorkspaceRevision({
      workspaceId: 'ws_1',
      revisionId: 'rev_2',
      parentRevisionId: 'rev_1',
      files: [{ path: 'package.json', content: '{"name":"app"}', encoding: 'utf8' }],
      presentPaths: ['package.json', 'src/assets/hero.png'],
    });

    expect(committed.files.map((f) => f.path).sort()).toEqual([
      'package.json',
      'src/assets/hero.png',
    ]);
    expect(committed.files.find((f) => f.path === 'src/assets/hero.png')?.objectKey).toBe(
      'appbuilder/blobs/sha256/bb/bbb',
    );
    expect(committed.files.find((f) => f.path === 'package.json')?.size).toBe(
      Buffer.byteLength('{"name":"app"}', 'utf8'),
    );
  });

  it('commitWorkspaceRevision inherits non-text parent files without presentPaths (legacy clients)', async () => {
    const parentFiles = [
      {
        path: 'src/App.jsx',
        sha256: 'a'.repeat(64),
        objectKey: 'appbuilder/blobs/sha256/aa/aaa',
        size: 10,
      },
      {
        path: 'src/assets/hero.png',
        sha256: 'b'.repeat(64),
        objectKey: 'appbuilder/blobs/sha256/bb/bbb',
        size: 4,
      },
    ];
    findByWorkspaceAndRevision.mockImplementation(async (_ws: string, revisionId: string) => {
      if (revisionId === 'rev_1') {
        return {
          id: 'parent_id',
          workspaceId: 'ws_1',
          revisionId: 'rev_1',
          parentRevisionId: null,
          manifestHash: 'hash_1',
          manifestObjectKey: 'appbuilder/manifests/ws_1/rev_1.json',
          files: parentFiles,
          createdByToolCallId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
      return null;
    });
    existsByWorkspaceAndRevision.mockResolvedValue(true);

    const committed = await svc.commitWorkspaceRevision({
      workspaceId: 'ws_1',
      revisionId: 'rev_2',
      parentRevisionId: 'rev_1',
      files: [{ path: 'src/App.jsx', content: 'export default null;\n' }],
    });

    expect(committed.files.map((f) => f.path).sort()).toEqual([
      'src/App.jsx',
      'src/assets/hero.png',
    ]);
  });

  it('commitWorkspaceRevision uploads base64 binaries', async () => {
    findByWorkspaceAndRevision.mockResolvedValue(null);
    exists.mockResolvedValue(false);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const committed = await svc.commitWorkspaceRevision({
      workspaceId: 'ws_1',
      revisionId: 'rev_1',
      parentRevisionId: null,
      files: [
        { path: 'package.json', content: '{}', encoding: 'utf8' },
        {
          path: 'src/assets/hero.png',
          content: png.toString('base64'),
          encoding: 'base64',
        },
      ],
      presentPaths: ['package.json', 'src/assets/hero.png'],
    });

    expect(committed.files.find((f) => f.path === 'src/assets/hero.png')?.size).toBe(4);
    expect(upload).toHaveBeenCalledWith(
      png,
      'hero.png',
      'application/octet-stream',
      expect.objectContaining({ generateUniqueName: false }),
    );
  });

  it('commitWorkspaceRevision drops parent files absent from presentPaths', async () => {
    const parentFiles = [
      {
        path: 'package.json',
        sha256: 'a'.repeat(64),
        objectKey: 'appbuilder/blobs/sha256/aa/aaa',
        size: 2,
      },
      {
        path: 'src/assets/gone.png',
        sha256: 'b'.repeat(64),
        objectKey: 'appbuilder/blobs/sha256/bb/bbb',
        size: 4,
      },
    ];
    findByWorkspaceAndRevision.mockImplementation(async (_ws: string, revisionId: string) => {
      if (revisionId === 'rev_1') {
        return {
          id: 'parent_id',
          workspaceId: 'ws_1',
          revisionId: 'rev_1',
          parentRevisionId: null,
          manifestHash: 'hash_1',
          manifestObjectKey: 'appbuilder/manifests/ws_1/rev_1.json',
          files: parentFiles,
          createdByToolCallId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
      return null;
    });
    existsByWorkspaceAndRevision.mockResolvedValue(true);

    const committed = await svc.commitWorkspaceRevision({
      workspaceId: 'ws_1',
      revisionId: 'rev_2',
      parentRevisionId: 'rev_1',
      files: [{ path: 'package.json', content: '{}' }],
      presentPaths: ['package.json'],
    });

    expect(committed.files.map((f) => f.path)).toEqual(['package.json']);
  });

  it('resolves a published template revision from its Ceph manifest', async () => {
    findByRevisionId.mockResolvedValueOnce({
      id: 'tpl_1',
      revisionId: 'template_tpl_1',
      status: 'published',
      manifestObjectKey: 'appbuilder/manifests/_system/template_tpl_1.json',
    });
    download.mockResolvedValueOnce(
      Buffer.from(
        JSON.stringify({
          revisionId: 'template_tpl_1',
          parentRevisionId: null,
          files: [
            { path: 'package.json', sha256: 'a'.repeat(64), objectKey: 'blobs/aaa', size: 3 },
            { path: 'src/App.jsx', sha256: 'b'.repeat(64), objectKey: 'blobs/bbb', size: 4 },
          ],
        }),
        'utf8',
      ),
    );

    const revision = await svc.getAuthorizedRevision('sess_1', 'template_tpl_1');

    expect(findByRevisionId).toHaveBeenCalledWith('template_tpl_1');
    expect(download).toHaveBeenCalledWith('appbuilder/manifests/_system/template_tpl_1.json');
    expect(revision.revisionId).toBe('template_tpl_1');
    expect(revision.workspaceId).toBe('_system');
    expect(revision.files.map((f) => f.path)).toEqual(['package.json', 'src/App.jsx']);
  });

  it('resolves a template revision from the database without downloading Ceph', async () => {
    const files = [
      { path: 'package.json', sha256: 'a'.repeat(64), objectKey: 'blobs/db', size: 3 },
    ];
    findRevisionByRevisionId.mockResolvedValueOnce({
      revisionId: 'template_tpl_1',
      manifestObjectKey: 'appbuilder/manifests/_system/template_tpl_1.json',
      manifestHash: 'db-hash',
      files,
    });

    const revision = await svc.getAuthorizedRevision('sess_1', 'template_tpl_1');

    expect(revision.manifestHash).toBe('db-hash');
    expect(revision.files).toEqual(files);
    expect(download).not.toHaveBeenCalled();
    expect(findByRevisionId).not.toHaveBeenCalled();
  });

  it('resolves a staging template revision from Ceph when there is no catalog row', async () => {
    const stagingId = '2db1f54802d17404cc212246';
    const revisionId = `template_${stagingId}`;
    exists.mockResolvedValueOnce(true);
    download.mockResolvedValueOnce(
      Buffer.from(
        JSON.stringify({
          revisionId,
          parentRevisionId: null,
          files: [
            { path: 'package.json', sha256: 'a'.repeat(64), objectKey: 'blobs/aaa', size: 3 },
          ],
        }),
        'utf8',
      ),
    );

    const revision = await svc.getAuthorizedRevision('sess_1', revisionId);

    expect(findByRevisionId).toHaveBeenCalledWith(revisionId);
    expect(exists).toHaveBeenCalledWith(`appbuilder/manifests/_system/${revisionId}.json`);
    expect(revision.revisionId).toBe(revisionId);
    expect(revision.files.map((f) => f.path)).toEqual(['package.json']);
  });

  it('rejects an unpublished or unknown template revision', async () => {
    exists.mockResolvedValueOnce(false);
    await expect(
      svc.getAuthorizedRevision('sess_1', 'template_missing'),
    ).rejects.toBeInstanceOf(NotFoundException);

    findByRevisionId.mockResolvedValueOnce({
      id: 'tpl_1',
      revisionId: 'template_tpl_1',
      status: 'draft',
      manifestObjectKey: null,
    });
    await expect(
      svc.getAuthorizedRevision('sess_1', 'template_tpl_1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('revisionExists accepts only a published template revision', async () => {
    findByRevisionId.mockResolvedValueOnce({
      id: 'tpl_1',
      revisionId: 'template_tpl_1',
      status: 'published',
      manifestObjectKey: 'appbuilder/manifests/_system/template_tpl_1.json',
    });
    expect(await svc.revisionExists('sess_1', 'template_tpl_1')).toBe(true);

    findByRevisionId.mockResolvedValueOnce(null);
    exists.mockResolvedValueOnce(false);
    expect(await svc.revisionExists('sess_1', 'template_unknown')).toBe(false);

    findByRevisionId.mockResolvedValueOnce(null);
    exists.mockResolvedValueOnce(true);
    expect(await svc.revisionExists('sess_1', 'template_stagingonly')).toBe(true);
  });
});
