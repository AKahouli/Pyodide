import { PgDialect } from 'drizzle-orm/pg-core';
import { WorkspaceDocumentTree } from './document-tree';
import { WorkspaceDocumentWrite } from './document-write';
import { WorkspaceDocumentSupport, isUniqueDocumentNameViolation } from './document-support';
import { BadRequestException, ConflictException } from '../../exceptions';
import { DocumentStatus, IndexingStatus } from '../interfaces/document-status.enum';
import {
  PgWorkspaceDocumentReadAdapter,
  documentFilterToWhere,
} from '../persistence/postgres/pg-workspace-document-read.adapter';
import { PgWorkspaceStore } from '../stores/postgres/pg-workspace-store';
import { PgUploadSessionStore } from '../stores/postgres/pg-upload-session-store';

const WS = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_WS = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const USER = 'cccccccccccccccccccccccc';

const logger = () => ({ setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() });

function doc(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    workspaceId: WS,
    createdBy: USER,
    originalName: `${id}.pdf`,
    mimeType: 'application/pdf',
    size: 10,
    path: `p/${id}.pdf`,
    status: DocumentStatus.COMPLETED,
    indexingStatus: IndexingStatus.READY,
    isFolder: false,
    ...patch,
  };
}

describe('WorkspaceDocumentTree folder deletion', () => {
  // root folder F1 -> { d1, F2 -> { d2 } }
  const tree: Record<string, ReturnType<typeof doc>[]> = {
    F1: [doc('d1', { parentId: 'F1' }), doc('F2', { isFolder: true, parentId: 'F1', path: undefined })],
    F2: [doc('d2', { parentId: 'F2' })],
  };

  function build(artifactCount = 0) {
    const deleted: string[] = [];
    const documentStore = {
      findByIdAndWorkspace: jest.fn(async (id: string) =>
        id === 'F1' ? doc('F1', { isFolder: true, path: undefined }) : null),
      findById: jest.fn(async (id: string) =>
        id === 'F1' ? doc('F1', { isFolder: true, path: undefined }) : null),
      findDirectChildren: jest.fn(async (id: string) => tree[id] ?? []),
      deleteById: jest.fn(async (id: string) => { deleted.push(id); }),
      deleteByIdAndWorkspace: jest.fn(async (id: string) => { deleted.push(id); }),
    };
    const workspaceService = { updateStorageUsage: jest.fn(async () => undefined) };
    const documentService = { delete: jest.fn(async () => undefined) };
    const indexingService = { deleteDocumentIndex: jest.fn(async () => undefined) };
    const artifacts = {
      countBySource: jest.fn(async () => 0),
      countBySourceDocumentIds: jest.fn(async () => artifactCount),
      deleteBySource: jest.fn(async () => undefined),
    };
    const support = { recordWorkspaceEvent: jest.fn(async () => undefined) };
    const svc = new WorkspaceDocumentTree(
      documentStore as never,
      {} as never,
      workspaceService as never,
      documentService as never,
      indexingService as never,
      artifacts as never,
      support as never,
      logger() as never,
    );
    return { svc, deleted, documentStore, workspaceService, documentService, indexingService, artifacts, support };
  }

  it('delete() on a folder cleans up every descendant, children before parents', async () => {
    const t = build();
    await t.svc.delete(WS, USER, 'F1');
    expect(t.deleted).toEqual(['d1', 'd2', 'F2', 'F1']);
    expect(t.documentService.delete).toHaveBeenCalledTimes(2);
    expect(t.indexingService.deleteDocumentIndex).toHaveBeenCalledTimes(2);
    expect(t.support.recordWorkspaceEvent).toHaveBeenCalledTimes(2);
    expect(t.workspaceService.updateStorageUsage).toHaveBeenCalledTimes(2);
    expect(t.artifacts.countBySourceDocumentIds).toHaveBeenCalledWith(['d1', 'd2']);
    expect(t.artifacts.countBySource).not.toHaveBeenCalled();
  });

  it('refuses a folder delete with linked artifacts unless cascading', async () => {
    const t = build(3);
    await expect(t.svc.delete(WS, USER, 'F1')).rejects.toBeInstanceOf(ConflictException);
    expect(t.deleted).toEqual([]);
    await t.svc.delete(WS, USER, 'F1', true);
    expect(t.artifacts.deleteBySource).toHaveBeenCalledTimes(2);
  });

  it('bulkDelete routes folders through the recursive path', async () => {
    const t = build();
    await expect(t.svc.bulkDelete(WS, USER, ['F1'])).resolves.toEqual({ deleted: 1, failed: [] });
    expect(t.deleted).toEqual(['d1', 'd2', 'F2', 'F1']);
  });

  it('deleteFolder uses one batched artifact count', async () => {
    const t = build();
    await expect(t.svc.deleteFolder(WS, USER, 'F1')).resolves.toEqual({ deletedFolders: 2, deletedDocuments: 2 });
    expect(t.artifacts.countBySourceDocumentIds).toHaveBeenCalledTimes(1);
  });

  it('terminates on a pre-existing parent cycle', async () => {
    const t = build();
    t.documentStore.findDirectChildren.mockImplementation(async (id: string) =>
      id === 'F1' ? [doc('F2', { isFolder: true })] : [doc('F1', { isFolder: true })]);
    await expect(t.svc.deleteFolder(WS, USER, 'F1')).resolves.toBeDefined();
  });
});

describe('WorkspaceDocumentWrite.moveDocuments', () => {
  function build(records: Record<string, ReturnType<typeof doc>>, childFolders: Record<string, string[]> = {}) {
    const calls: string[] = [];
    const documentStore = {
      findById: jest.fn(async (id: string) => records[id] ?? records[id.toUpperCase()] ?? null),
      findChildFolderIds: jest.fn(async (id: string) => childFolders[id.toUpperCase()] ?? []),
      setParent: jest.fn(async (id: string) => { calls.push(`set:${id}`); }),
      withWorkspaceTreeLock: jest.fn(async (ws: string, fn: () => Promise<unknown>) => {
        calls.push(`lock:${ws}`);
        return fn();
      }),
    };
    const svc = new WorkspaceDocumentWrite(
      documentStore as never,
      {} as never,
      {} as never,
      {} as never,
      { get: jest.fn((_k: string, d: unknown) => d) } as never,
      {} as never,
      {} as never,
      logger() as never,
    );
    return { svc, calls, documentStore };
  }

  it('rejects a target folder from another workspace', async () => {
    const t = build({ T: doc('T', { isFolder: true, workspaceId: OTHER_WS }), d1: doc('d1') });
    await expect(t.svc.moveDocuments(WS, ['d1'], 'T', USER)).rejects.toBeInstanceOf(BadRequestException);
    expect(t.documentStore.setParent).not.toHaveBeenCalled();
  });

  it('fails items that belong to another workspace', async () => {
    const t = build({ T: doc('T', { isFolder: true }), d1: doc('d1', { workspaceId: OTHER_WS }), d2: doc('d2') });
    await expect(t.svc.moveDocuments(WS, ['d1', 'd2'], 'T', USER)).resolves.toEqual({ moved: 1, failed: ['d1'] });
  });

  it('runs the cycle check and move under the workspace tree lock and refuses cycles', async () => {
    const t = build(
      { A: doc('A', { isFolder: true }), B: doc('B', { isFolder: true, parentId: 'A' }) },
      { A: ['b'], B: ['a'] }, // corrupted cycle must not loop forever either
    );
    const result = await t.svc.moveDocuments(WS, ['A'], 'B', USER);
    expect(result.failed).toEqual(['A']);
    expect(t.calls).toEqual([`lock:${WS}`]);
  });

  it('moves under the lock', async () => {
    const t = build({ T: doc('T', { isFolder: true }), d1: doc('d1') });
    await t.svc.moveDocuments(WS, ['D1'], 'T', USER);
    expect(t.calls).toEqual([`lock:${WS}`, 'set:d1']);
  });
});

describe('WorkspaceDocumentWrite direct upload reserves the name before writing the blob', () => {
  function build(uploadImpl: () => Promise<unknown>) {
    const calls: string[] = [];
    const documentStore = {
      updateById: jest.fn(async (id: string, patch: Record<string, unknown>) => {
        calls.push(`complete:${patch.status}`);
        return { ...doc(id), ...patch };
      }),
      deleteById: jest.fn(async (id: string) => { calls.push(`release:${id}`); }),
    };
    const documentService = {
      upload: jest.fn(async (_file: Buffer, name: string) => {
        calls.push(`upload:${name}`);
        return uploadImpl();
      }),
    };
    const support = {
      validateFile: jest.fn(async () => undefined),
      sanitizeFilename: (n: string) => n,
      mapToResponse: (d: unknown) => d,
      createWithUniqueName: jest.fn(async (_ws: string, name: string, build: (n: string) => Record<string, unknown>) => {
        const input = build(name);
        calls.push(`reserve:${input.status}`);
        return { ...doc(String(input.id)), ...input };
      }),
    };
    const workspaceService = {
      checkStorageQuota: jest.fn(async () => ({ allowed: true, available: 1e9 })),
      updateStorageUsage: jest.fn(async () => undefined),
    };
    const svc = new WorkspaceDocumentWrite(
      documentStore as never,
      workspaceService as never,
      documentService as never,
      {} as never,
      { get: jest.fn((_k: string, d: unknown) => d) } as never,
      {} as never,
      support as never,
      logger() as never,
    );
    return { svc, calls, documentStore, workspaceService };
  }

  it('creates the UPLOADING row, then uploads, then completes it', async () => {
    const t = build(async () => ({ storedName: 'a.pdf', blobPath: 'p/a.pdf', url: 'u', contentHash: 'h' }));
    const res = (await t.svc.uploadSmallFileWithPath(WS, USER, Buffer.from('x'), 'a.pdf', 'application/pdf', 'p')) as {
      status: string;
      path: string;
    };
    expect(t.calls).toEqual([`reserve:${DocumentStatus.UPLOADING}`, 'upload:a.pdf', `complete:${DocumentStatus.COMPLETED}`]);
    expect(res.status).toBe(DocumentStatus.COMPLETED);
    expect(res.path).toBe('p/a.pdf');
  });

  it('releases the reservation and rethrows when the blob write fails', async () => {
    const t = build(async () => {
      throw new Error('ceph down');
    });
    await expect(
      t.svc.uploadSmallFileWithPath(WS, USER, Buffer.from('x'), 'a.pdf', 'application/pdf', 'p'),
    ).rejects.toThrow('ceph down');
    expect(t.calls[0]).toBe(`reserve:${DocumentStatus.UPLOADING}`);
    expect(t.calls.some((c) => c.startsWith('release:'))).toBe(true);
    expect(t.workspaceService.updateStorageUsage).not.toHaveBeenCalled();
  });
});

describe('WorkspaceDocumentSupport.createWithUniqueName', () => {
  const violation = () => Object.assign(new Error('dup'), { code: '23505', constraint: 'uq_documents_ws_name_files' });

  function build(create: jest.Mock, existing: Set<string>) {
    const documentStore = {
      create,
      originalNameExists: jest.fn(async (_ws: string, name: string) => existing.has(name)),
    };
    return new WorkspaceDocumentSupport(
      documentStore as never,
      {} as never,
      { get: jest.fn((_k: string, d: unknown) => d) } as never,
      {} as never,
      logger() as never,
    );
  }

  it('recognises direct and drizzle-wrapped unique violations', () => {
    expect(isUniqueDocumentNameViolation(violation())).toBe(true);
    expect(isUniqueDocumentNameViolation(new Error('wrapped', { cause: violation() }))).toBe(true);
    expect(isUniqueDocumentNameViolation(Object.assign(new Error('x'), { code: '23505', constraint: 'other' }))).toBe(false);
  });

  it('retries with the next free name after a concurrent insert wins', async () => {
    const existing = new Set<string>();
    const create = jest.fn(async (input: { originalName: string }) => {
      if (create.mock.calls.length === 1) {
        existing.add(input.originalName); // concurrent winner committed
        throw new Error('Failed query', { cause: violation() });
      }
      return { id: 'x', ...input };
    });
    const support = build(create, existing);
    const result = await support.createWithUniqueName(WS, 'report.pdf', (name) => ({ originalName: name }) as never);
    expect(result.originalName).toBe('report_(1).pdf');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('gives up after a bounded number of attempts and rethrows other errors', async () => {
    const always = jest.fn(async () => { throw violation(); });
    await expect(build(always, new Set()).createWithUniqueName(WS, 'a.pdf', (n) => ({ originalName: n }) as never)).rejects.toThrow('dup');
    expect(always).toHaveBeenCalledTimes(5);
    const other = jest.fn(async () => { throw new Error('boom'); });
    await expect(build(other, new Set()).createWithUniqueName(WS, 'a.pdf', (n) => ({ originalName: n }) as never)).rejects.toThrow('boom');
    expect(other).toHaveBeenCalledTimes(1);
  });
});

describe('empty id-list filters match nothing', () => {
  const dialect = new PgDialect();
  const render = (filter: Parameters<typeof documentFilterToWhere>[0]) =>
    dialect.sqlToQuery(documentFilterToWhere(filter)!).sql;

  it('translates [] to false instead of dropping the condition', () => {
    expect(render({ ids: [] })).toContain('false');
    expect(render({ workspaceIds: [] })).toContain('false');
    expect(render({ ids: ['a'] })).toContain('in');
  });

  it('read adapter short-circuits without querying', async () => {
    const db = { select: jest.fn() };
    const adapter = new PgWorkspaceDocumentReadAdapter(db as never);
    await expect(adapter.find({ ids: [] })).resolves.toEqual([]);
    await expect(adapter.findOne({ workspaceIds: [] })).resolves.toBeNull();
    await expect(adapter.countDocuments({ ids: [] })).resolves.toBe(0);
    await expect(adapter.exists({ workspaceIds: [] })).resolves.toBe(false);
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe('PgWorkspaceStore.incrementCounters clamps at zero', () => {
  it('wraps every counter in GREATEST(..., 0)', async () => {
    let values: Record<string, unknown> = {};
    const db = {
      update: () => ({ set: (v: Record<string, unknown>) => { values = v; return { where: async () => undefined }; } }),
    };
    await new PgWorkspaceStore(db as never).incrementCounters(WS, { documentCount: -1, usedStorage: -10, shareCount: -1 });
    const dialect = new PgDialect();
    for (const key of ['documentCount', 'usedStorage', 'shareCount']) {
      expect(dialect.sqlToQuery(values[key] as never).sql).toMatch(/^GREATEST\(.* \+ \$1, 0\)$/);
    }
  });
});

describe('PgUploadSessionStore.findExpired', () => {
  it('limits sessions and loads all files in one query', async () => {
    const session = (id: string) => ({ id, workspaceId: WS, userId: USER, status: 'pending', totalFiles: 1, totalSize: 1, completedFiles: 0, failedFiles: 0, expiresAt: new Date(0), createdAt: new Date(), updatedAt: new Date() });
    const file = (sessionId: string, fileIndex: number) => ({ sessionId, fileIndex, filename: 'f', mimeType: 'm', size: 1, documentId: null, uploadUrl: null, status: 'pending', progress: 0, error: null });
    const limit = jest.fn();
    const queries: string[] = [];
    const chain = (rows: unknown[], name: string) => {
      const c: Record<string, unknown> = {};
      c.from = () => c;
      c.where = () => c;
      c.orderBy = () => c;
      c.limit = (n: number) => { limit(n); return c; };
      c.then = (res: (v: unknown) => unknown) => { queries.push(name); return Promise.resolve(rows).then(res); };
      return c;
    };
    let call = 0;
    const db = {
      select: () => (call++ === 0
        ? chain([session('s1'), session('s2')], 'sessions')
        : chain([file('s1', 0), file('s2', 0), file('s2', 1)], 'files')),
    };
    const result = await new PgUploadSessionStore(db as never).findExpired(new Date());
    expect(limit).toHaveBeenCalledWith(500);
    expect(queries).toEqual(['sessions', 'files']);
    expect(result.map((r) => r.files.length)).toEqual([1, 2]);
  });
});
