import { newObjectId } from '@common/postgres';
import { WorkyMemoryService } from './worky-memory.service';
import type { WorkyMemoryEntryRecord, WorkyMemoryProposalRecord } from '../worky.types';

const makeService = (proposalStatus = 'pending') => {
  const now = new Date();
  const proposal: WorkyMemoryProposalRecord = {
    id: newObjectId(),
    ownerUserId: newObjectId(),
    sourceStreamId: newObjectId(),
    category: 'stream_summary',
    title: 'Stream summary: test',
    content: 'summary text',
    status: proposalStatus,
    decidedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const entry: WorkyMemoryEntryRecord = {
    id: newObjectId(),
    ownerUserId: proposal.ownerUserId,
    sourceProposalId: proposal.id,
    sourceStreamId: proposal.sourceStreamId,
    category: 'stream_summary',
    title: 'Stream summary: test',
    content: 'summary text',
    createdAt: now,
    updatedAt: now,
  };
  const memories = {
    createProposal: jest.fn().mockImplementation(async (input: Record<string, unknown>) => ({
      ...proposal,
      id: newObjectId(),
      ...input,
      status: 'pending',
    })),
    findProposal: jest.fn().mockResolvedValue(proposal),
    findEntryByProposal: jest.fn().mockResolvedValue(entry),
    confirm: jest.fn().mockResolvedValue({ proposal: { ...proposal, status: 'confirmed', decidedAt: now }, entry }),
    reject: jest.fn().mockResolvedValue({ ...proposal, status: 'rejected', decidedAt: now }),
    listProposals: jest.fn().mockResolvedValue([proposal]),
    listEntries: jest.fn().mockResolvedValue([entry]),
  };
  const events = { emit: jest.fn() };
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const service = new WorkyMemoryService(memories as never, events as never, audit as never, logger as never);
  return { service, memories, events, audit, proposal, entry };
};

describe('WorkyMemoryService.propose', () => {
  it('persists a proposal and emits memory.proposed', async () => {
    const { service, memories, events, audit } = makeService();
    const ownerUserId = newObjectId();
    const sourceStreamId = newObjectId();
    const result = await service.propose({
      ownerUserId,
      sourceStreamId,
      category: 'stream_summary',
      title: 'Test',
      content: 'content',
    });
    expect(memories.createProposal).toHaveBeenCalledWith({
      ownerUserId,
      sourceStreamId,
      category: 'stream_summary',
      title: 'Test',
      content: 'content',
    });
    expect(result.status).toBe('pending');
    expect(result.sourceStreamId).toBe(sourceStreamId);
    expect(events.emit).toHaveBeenCalledWith(
      ownerUserId,
      sourceStreamId,
      expect.objectContaining({ type: 'memory.proposed', payload: expect.objectContaining({ proposalId: result.id }) }),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ streamId: sourceStreamId, action: 'memory.proposed', targetId: result.id }),
    );
  });

  it('scopes the audit row to the owner when the proposal has no stream', async () => {
    const { service, memories, audit } = makeService();
    const ownerUserId = newObjectId();
    await service.propose({ ownerUserId, category: 'preference', title: 'Tone', content: 'Formal' });
    expect(memories.createProposal).toHaveBeenCalledWith(expect.objectContaining({ sourceStreamId: null }));
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ streamId: ownerUserId }));
  });

  it('rejects an invalid category', async () => {
    const { service, memories } = makeService();
    await expect(
      service.propose({
        ownerUserId: newObjectId(),
        category: 'invalid' as never,
        title: 'x',
        content: 'y',
      }),
    ).rejects.toThrow(/invalid category/);
    expect(memories.createProposal).not.toHaveBeenCalled();
  });
});

describe('WorkyMemoryService.confirm', () => {
  it('transitions pending → confirmed and creates the entry', async () => {
    const { service, memories, events, audit, proposal, entry } = makeService();
    const result = await service.confirm({ proposalId: proposal.id, actorUserId: newObjectId() });
    expect(memories.confirm).toHaveBeenCalledWith(proposal.id);
    expect(events.emit).toHaveBeenCalledWith(
      proposal.ownerUserId,
      proposal.sourceStreamId,
      expect.objectContaining({ type: 'memory.confirmed', payload: expect.objectContaining({ entryId: entry.id }) }),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'memory.confirmed', targetId: entry.id }),
    );
    expect(result).toMatchObject({ id: entry.id, sourceProposalId: proposal.id });
  });

  it('is idempotent on already-confirmed proposals', async () => {
    const { service, memories, events, proposal, entry } = makeService('confirmed');
    const result = await service.confirm({ proposalId: proposal.id, actorUserId: newObjectId() });
    expect(memories.confirm).not.toHaveBeenCalled();
    expect(memories.findEntryByProposal).toHaveBeenCalledWith(proposal.id);
    expect(result.id).toBe(entry.id);
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('rejects confirming a rejected proposal', async () => {
    const { service, memories, proposal } = makeService('rejected');
    await expect(
      service.confirm({ proposalId: proposal.id, actorUserId: newObjectId() }),
    ).rejects.toThrow('WorkyMemoryService.confirm: proposal is in status rejected, cannot confirm');
    expect(memories.confirm).not.toHaveBeenCalled();
  });

  it('answers a concurrent confirmation with the entry it created', async () => {
    const { service, memories, events, proposal, entry } = makeService();
    memories.confirm.mockResolvedValueOnce(null);
    memories.findProposal.mockResolvedValueOnce(proposal).mockResolvedValueOnce({ ...proposal, status: 'confirmed' });
    const result = await service.confirm({ proposalId: proposal.id, actorUserId: newObjectId() });
    expect(result.id).toBe(entry.id);
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('refuses when a concurrent rejection won', async () => {
    const { service, memories, proposal } = makeService();
    memories.confirm.mockResolvedValueOnce(null);
    memories.findProposal.mockResolvedValueOnce(proposal).mockResolvedValueOnce({ ...proposal, status: 'rejected' });
    await expect(service.confirm({ proposalId: proposal.id, actorUserId: newObjectId() })).rejects.toThrow(/status rejected, cannot confirm/);
  });

  it('reports an unknown or malformed proposal id', async () => {
    const { service, memories } = makeService();
    memories.findProposal.mockResolvedValueOnce(null);
    const missing = newObjectId();
    await expect(service.confirm({ proposalId: missing, actorUserId: newObjectId() })).rejects.toThrow(
      `WorkyMemoryService.confirm: proposal ${missing} not found`,
    );
    await expect(service.confirm({ proposalId: 'nope', actorUserId: newObjectId() })).rejects.toThrow(/invalid proposalId/);
  });
});

describe('WorkyMemoryService.reject', () => {
  it('transitions pending → rejected and writes nothing', async () => {
    const { service, memories, events, audit, proposal } = makeService();
    const result = await service.reject({
      proposalId: proposal.id,
      actorUserId: newObjectId(),
      reason: 'not relevant',
    });
    expect(memories.reject).toHaveBeenCalledWith(proposal.id);
    expect(memories.confirm).not.toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith(
      proposal.ownerUserId,
      proposal.sourceStreamId,
      expect.objectContaining({ type: 'memory.rejected', payload: { proposalId: proposal.id, reason: 'not relevant' } }),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'memory.rejected' }),
    );
    expect(result.status).toBe('rejected');
  });

  it('rejects re-rejecting an already-rejected proposal', async () => {
    const { service, memories, proposal } = makeService('rejected');
    await expect(
      service.reject({ proposalId: proposal.id, actorUserId: newObjectId() }),
    ).rejects.toThrow('WorkyMemoryService.reject: proposal is in status rejected, cannot reject');
    expect(memories.reject).not.toHaveBeenCalled();
  });

  it('refuses when a concurrent decision won', async () => {
    const { service, memories, events, proposal } = makeService();
    memories.reject.mockResolvedValueOnce(null);
    memories.findProposal.mockResolvedValueOnce(proposal).mockResolvedValueOnce({ ...proposal, status: 'confirmed' });
    await expect(service.reject({ proposalId: proposal.id, actorUserId: newObjectId() })).rejects.toThrow(
      /status confirmed, cannot reject/,
    );
    expect(events.emit).not.toHaveBeenCalled();
  });
});

describe('WorkyMemoryService.findProposals / findForOwner', () => {
  it('returns the owner proposals and entries within their limits', async () => {
    const { service, memories, proposal, entry } = makeService();
    const ownerUserId = newObjectId();
    const proposals = await service.findProposals(ownerUserId, 'pending');
    expect(memories.listProposals).toHaveBeenCalledWith(ownerUserId, 'pending', 100);
    expect(proposals.map((p) => p.id)).toEqual([proposal.id]);
    const entries = await service.findForOwner(ownerUserId);
    expect(memories.listEntries).toHaveBeenCalledWith(ownerUserId, 200);
    expect(entries.map((e) => e.id)).toEqual([entry.id]);
  });

  it('returns nothing for a malformed owner id', async () => {
    const { service, memories } = makeService();
    expect(await service.findProposals('nope')).toEqual([]);
    expect(await service.findForOwner('nope')).toEqual([]);
    expect(memories.listProposals).not.toHaveBeenCalled();
  });
});
