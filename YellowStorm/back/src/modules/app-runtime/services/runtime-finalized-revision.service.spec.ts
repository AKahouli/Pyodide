import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConversationV2EventStoreService } from '@modules/conversation-v2/services/conversation-v2-event-store.service';
import { RUNTIME_FINALIZED_REVISION_STORE, type RuntimeFinalizedRevisionStore } from '../persistence/runtime-finalized-revision.store';
import { RuntimeFinalizedRevisionService } from './runtime-finalized-revision.service';

describe('RuntimeFinalizedRevisionService', () => {
  let svc: RuntimeFinalizedRevisionService;

  const upsert = jest.fn();
  const listByWorkspace = jest.fn();
  const resolveLatestFinalized = jest.fn();
  const existsByWorkspaceAndRevision = jest.fn();
  const summarizeByWorkspaces = jest.fn();
  const listByType = jest.fn();

  const store: RuntimeFinalizedRevisionStore = {
    upsert,
    listByWorkspace,
    resolveLatestFinalized,
    existsByWorkspaceAndRevision,
    summarizeByWorkspaces,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    listByWorkspace.mockResolvedValue([]);
    resolveLatestFinalized.mockResolvedValue(null);
    existsByWorkspaceAndRevision.mockResolvedValue(false);
    upsert.mockResolvedValue(undefined);
    listByType.mockResolvedValue([]);
    summarizeByWorkspaces.mockResolvedValue(new Map());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RuntimeFinalizedRevisionService,
        {
          provide: RUNTIME_FINALIZED_REVISION_STORE,
          useValue: store,
        },
        {
          provide: ConversationV2EventStoreService,
          useValue: { listByType },
        },
      ],
    }).compile();

    svc = module.get(RuntimeFinalizedRevisionService);
  });

  it('records a finalized revision with upsert', async () => {
    await svc.record({
      workspaceId: 'ws-1',
      revisionId: 'rev_7',
      title: 'My App',
      eventId: 'evt-1',
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        revisionId: 'rev_7',
        title: 'My App',
        eventId: 'evt-1',
      }),
    );
  });

  it('lists finalized revisions newest first', async () => {
    const rows = [
      {
        id: 'id1',
        workspaceId: 'ws-1',
        revisionId: 'rev_10',
        title: 'App',
        finalizedAt: new Date('2026-09-02T10:00:00.000Z'),
        eventId: 'evt-1',
        fileCount: 12,
        cephManifestPath: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'id2',
        workspaceId: 'ws-1',
        revisionId: 'rev_7',
        title: 'App',
        finalizedAt: new Date('2026-09-01T10:00:00.000Z'),
        eventId: 'evt-2',
        fileCount: null,
        cephManifestPath: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    listByWorkspace.mockResolvedValueOnce(rows);

    const items = await svc.listByWorkspace('ws-1');

    expect(items).toEqual([
      {
        revisionId: 'rev_10',
        title: 'App',
        finalizedAt: '2026-09-02T10:00:00.000Z',
        fileCount: 12,
      },
      {
        revisionId: 'rev_7',
        title: 'App',
        finalizedAt: '2026-09-01T10:00:00.000Z',
      },
    ]);
  });

  it('assertFinalized throws when revision is not finalized', async () => {
    existsByWorkspaceAndRevision.mockResolvedValueOnce(false);

    await expect(svc.assertFinalized('ws-1', 'rev_99')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('backfills from application_component events when collection is empty', async () => {
    listByWorkspace.mockResolvedValueOnce([]);
    listByType.mockResolvedValueOnce([
      {
        eventId: 'evt-a',
        emittedAt: 1_756_700_000,
        payload: {
          revision_id: 'rev_7',
          title: 'Backfill App',
          file_count: 8,
          ceph_path: 'appbuilder/manifests/ws-1/rev_7.json',
        },
      },
    ]);

    await svc.backfillFromEvents('pointer-1', 'ws-1');

    expect(listByType).toHaveBeenCalledWith('pointer-1', 'application_component');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        revisionId: 'rev_7',
        title: 'Backfill App',
        eventId: 'evt-a',
      }),
    );
  });

  it('summarizeByWorkspaces returns latest revision and counts per workspace', async () => {
    summarizeByWorkspaces.mockResolvedValueOnce(
      new Map([
        [
          'ws-1',
          {
            latestRevisionId: 'rev_12',
            latestFinalizedAt: '2026-09-02T10:00:00.000Z',
            versionCount: 3,
          },
        ],
      ]),
    );

    const summary = await svc.summarizeByWorkspaces(['ws-1', 'ws-2']);

    expect(summary.get('ws-1')).toEqual({
      latestRevisionId: 'rev_12',
      latestFinalizedAt: '2026-09-02T10:00:00.000Z',
      versionCount: 3,
    });
    expect(summary.has('ws-2')).toBe(false);
  });

  it('skips backfill when finalized rows already exist', async () => {
    listByWorkspace.mockResolvedValueOnce([
      {
        id: 'id1', workspaceId: 'ws-1', revisionId: 'rev_1', title: 'App',
        finalizedAt: new Date(), eventId: 'evt-1', fileCount: null, cephManifestPath: null,
        createdAt: new Date(), updatedAt: new Date(),
      },
    ]);

    await svc.backfillFromEvents('pointer-1', 'ws-1');

    expect(listByType).not.toHaveBeenCalled();
  });
});
