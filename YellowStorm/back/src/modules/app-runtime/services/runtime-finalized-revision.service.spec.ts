import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConversationV2EventStoreService } from '@modules/conversation-v2/services/conversation-v2-event-store.service';
import { AppFinalizedRevision } from '../schemas/app-finalized-revision.schema';
import { RuntimeFinalizedRevisionService } from './runtime-finalized-revision.service';

describe('RuntimeFinalizedRevisionService', () => {
  let svc: RuntimeFinalizedRevisionService;

  const find = jest.fn();
  const findOne = jest.fn();
  const updateOne = jest.fn();
  const listByType = jest.fn();
  const aggregate = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    find.mockReturnValue({
      sort: () => ({
        lean: () => ({ exec: () => Promise.resolve([]) }),
      }),
    });
    findOne.mockReturnValue({
      sort: () => ({
        select: () => ({
          lean: () => ({ exec: () => Promise.resolve(null) }),
        }),
      }),
      select: () => ({
        lean: () => ({ exec: () => Promise.resolve(null) }),
      }),
    });
    updateOne.mockResolvedValue({});
    listByType.mockResolvedValue([]);
    aggregate.mockReturnValue({ exec: () => Promise.resolve([]) });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RuntimeFinalizedRevisionService,
        {
          provide: getModelToken(AppFinalizedRevision.name),
          useValue: { find, findOne, updateOne, aggregate },
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

    expect(updateOne).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', revisionId: 'rev_7' },
      expect.objectContaining({
        $set: expect.objectContaining({ title: 'My App', eventId: 'evt-1' }),
      }),
      { upsert: true },
    );
  });

  it('lists finalized revisions newest first', async () => {
    const rows = [
      {
        revisionId: 'rev_10',
        title: 'App',
        finalizedAt: new Date('2026-09-02T10:00:00.000Z'),
        fileCount: 12,
      },
      {
        revisionId: 'rev_7',
        title: 'App',
        finalizedAt: new Date('2026-09-01T10:00:00.000Z'),
      },
    ];
    find.mockReturnValueOnce({
      sort: () => ({
        lean: () => ({ exec: () => Promise.resolve(rows) }),
      }),
    });

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
    findOne.mockReturnValueOnce({
      select: () => ({
        lean: () => ({ exec: () => Promise.resolve(null) }),
      }),
    });

    await expect(svc.assertFinalized('ws-1', 'rev_99')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('backfills from application_component events when collection is empty', async () => {
    findOne.mockReturnValueOnce({
      select: () => ({
        lean: () => ({ exec: () => Promise.resolve(null) }),
      }),
    });
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
    expect(updateOne).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', revisionId: 'rev_7' },
      expect.objectContaining({
        $set: expect.objectContaining({ title: 'Backfill App', eventId: 'evt-a' }),
      }),
      { upsert: true },
    );
  });

  it('summarizeByWorkspaces returns latest revision and counts per workspace', async () => {
    aggregate.mockReturnValueOnce({
      exec: () =>
        Promise.resolve([
          {
            _id: 'ws-1',
            latestRevisionId: 'rev_12',
            latestFinalizedAt: new Date('2026-09-02T10:00:00.000Z'),
            versionCount: 3,
          },
        ]),
    });

    const summary = await svc.summarizeByWorkspaces(['ws-1', 'ws-2']);

    expect(summary.get('ws-1')).toEqual({
      latestRevisionId: 'rev_12',
      latestFinalizedAt: '2026-09-02T10:00:00.000Z',
      versionCount: 3,
    });
    expect(summary.has('ws-2')).toBe(false);
  });

  it('skips backfill when finalized rows already exist', async () => {
    findOne.mockReturnValueOnce({
      select: () => ({
        lean: () => ({ exec: () => Promise.resolve({ _id: 'x' }) }),
      }),
    });

    await svc.backfillFromEvents('pointer-1', 'ws-1');

    expect(listByType).not.toHaveBeenCalled();
  });
});
