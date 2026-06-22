import { Types } from 'mongoose';
import { WorkyMemoryService } from './worky-memory.service';

interface MakeOptions {
  proposalStatus?: string;
}

const makeService = (options: MakeOptions = {}) => {
  const ownerObjectId = new Types.ObjectId();
  const streamObjectId = new Types.ObjectId();
  const proposalObjectId = new Types.ObjectId();
  const entryObjectId = new Types.ObjectId();
  const now = new Date();
  const proposalDoc: any = {
    _id: proposalObjectId,
    ownerUserId: ownerObjectId,
    sourceStreamId: streamObjectId,
    category: 'stream_summary',
    title: 'Stream summary: test',
    content: 'summary text',
    status: options.proposalStatus ?? 'pending',
    decidedAt: null,
    createdAt: now,
    updatedAt: now,
    save: jest.fn().mockImplementation(function (this: unknown) {
      return Promise.resolve(this);
    }),
  };
  const proposals = {
    create: jest.fn().mockImplementation((doc) => Promise.resolve({ _id: new Types.ObjectId(), createdAt: now, ...doc })),
    findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(proposalDoc) }),
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([proposalDoc]),
        }),
      }),
    }),
  };
  const entryDoc: any = {
    _id: entryObjectId,
    ownerUserId: ownerObjectId,
    sourceProposalId: proposalObjectId,
    sourceStreamId: streamObjectId,
    category: 'stream_summary',
    title: 'Stream summary: test',
    content: 'summary text',
    createdAt: now,
    updatedAt: now,
  };
  const entries = {
    create: jest.fn().mockResolvedValue(entryDoc),
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([entryDoc]),
        }),
      }),
    }),
    findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(entryDoc) }),
  };
  const events = { emit: jest.fn() };
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const service = new WorkyMemoryService(
    proposals as any,
    entries as any,
    events as any,
    audit as any,
    logger as any,
  );
  return { service, proposals, entries, events, audit, proposalDoc, entryDoc, ownerObjectId, streamObjectId };
};

describe('WorkyMemoryService.propose', () => {
  it('persists a proposal and emits memory.proposed', async () => {
    const { service, proposals, events, audit } = makeService();
    const result = await service.propose({
      ownerUserId: new Types.ObjectId().toString(),
      sourceStreamId: new Types.ObjectId().toString(),
      category: 'stream_summary',
      title: 'Test',
      content: 'content',
    });
    expect(proposals.create).toHaveBeenCalled();
    expect(result.status).toBe('pending');
    expect(events.emit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ type: 'memory.proposed' }),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'memory.proposed' }),
    );
  });

  it('rejects an invalid category', async () => {
    const { service } = makeService();
    await expect(
      service.propose({
        ownerUserId: new Types.ObjectId().toString(),
        category: 'invalid' as never,
        title: 'x',
        content: 'y',
      }),
    ).rejects.toThrow(/invalid category/);
  });
});

describe('WorkyMemoryService.confirm', () => {
  it('transitions pending → confirmed and creates the entry', async () => {
    const { service, entries, events, audit, proposalDoc } = makeService();
    const result = await service.confirm({
      proposalId: proposalDoc._id.toString(),
      actorUserId: new Types.ObjectId().toString(),
    });
    expect(proposalDoc.status).toBe('confirmed');
    expect(entries.create).toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ type: 'memory.confirmed' }),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'memory.confirmed' }),
    );
    expect(result.id).toBeDefined();
  });

  it('is idempotent on already-confirmed proposals', async () => {
    const { service, entries } = makeService({ proposalStatus: 'confirmed' });
    const result = await service.confirm({
      proposalId: new Types.ObjectId().toString(),
      actorUserId: new Types.ObjectId().toString(),
    });
    expect(entries.create).not.toHaveBeenCalled();
    expect(result.id).toBeDefined();
  });

  it('rejects confirming a rejected proposal', async () => {
    const { service } = makeService({ proposalStatus: 'rejected' });
    await expect(
      service.confirm({
        proposalId: new Types.ObjectId().toString(),
        actorUserId: new Types.ObjectId().toString(),
      }),
    ).rejects.toThrow(/cannot confirm/);
  });
});

describe('WorkyMemoryService.reject', () => {
  it('transitions pending → rejected and writes nothing', async () => {
    const { service, entries, events, audit, proposalDoc } = makeService();
    const result = await service.reject({
      proposalId: proposalDoc._id.toString(),
      actorUserId: new Types.ObjectId().toString(),
      reason: 'not relevant',
    });
    expect(proposalDoc.status).toBe('rejected');
    expect(entries.create).not.toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ type: 'memory.rejected' }),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'memory.rejected' }),
    );
    expect(result.status).toBe('rejected');
  });

  it('rejects re-rejecting an already-rejected proposal', async () => {
    const { service } = makeService({ proposalStatus: 'rejected' });
    await expect(
      service.reject({
        proposalId: new Types.ObjectId().toString(),
        actorUserId: new Types.ObjectId().toString(),
      }),
    ).rejects.toThrow(/cannot reject/);
  });
});

describe('WorkyMemoryService.findProposals / findForOwner', () => {
  it('returns the owner proposals and entries', async () => {
    const { service } = makeService();
    const proposals = await service.findProposals(new Types.ObjectId().toString());
    expect(Array.isArray(proposals)).toBe(true);
    const entries = await service.findForOwner(new Types.ObjectId().toString());
    expect(Array.isArray(entries)).toBe(true);
  });
});
