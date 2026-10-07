import { Injectable } from '@nestjs/common';
import { isObjectId } from '@common/postgres';
import { WorkyMemoryRepository } from '../persistence/worky-memory.repository';
import type { WorkyMemoryEntryRecord, WorkyMemoryProposalRecord } from '../worky.types';
import { LoggerService } from '../../logger';
import { WorkyEventService } from './worky-event.service';
import { WorkyAuditService } from './worky-audit.service';

export type WorkyMemoryCategory =
  | 'stream_summary'
  | 'preference'
  | 'person'
  | 'decision_history'
  | 'role_clarification';

export interface IWorkyMemoryProposalResponse {
  id: string;
  ownerUserId: string;
  sourceStreamId: string | null;
  category: string;
  title: string;
  content: string;
  status: string;
  createdAt: string;
}

export interface IWorkyMemoryEntryResponse {
  id: string;
  ownerUserId: string;
  category: string;
  title: string;
  content: string;
  sourceStreamId: string | null;
  sourceProposalId: string | null;
  createdAt: string;
}

export interface ProposeInput {
  ownerUserId: string;
  sourceStreamId?: string | null;
  category: WorkyMemoryCategory;
  title: string;
  content: string;
}

const VALID_CATEGORIES: ReadonlySet<string> = new Set([
  'stream_summary',
  'preference',
  'person',
  'decision_history',
  'role_clarification',
]);

/**
 * Owner-scoped memory (Part 4 §7, canonical §21). Memory writes are
 * always *proposed* first and only become durable after the owner
 * confirms. Rejected proposals write nothing.
 *
 *   - `propose(input)`  creates a proposal row, emits
 *     `memory.proposed`. The runtime / frontend can present the
 *     proposal to the owner.
 *   - `confirm(id)`     transitions the proposal to `confirmed` and
 *     creates the durable entry, in one transaction. Emits
 *     `memory.confirmed`. The runtime can pull the new entry via
 *     `findForOwner`.
 *   - `reject(id)`      transitions the proposal to `rejected`. NO
 *     entry is created. Emits `memory.rejected`.
 *   - `findProposals(ownerUserId, status?)` and `findForOwner(…)`
 *     return proposal / entry lists.
 *
 * Auto-trigger: the report service calls `propose({ category:
 * 'stream_summary', ... })` after a successful `generate()` so the
 * owner always sees a proposal for each completed stream.
 */
@Injectable()
export class WorkyMemoryService {
  constructor(
    private readonly memories: WorkyMemoryRepository,
    private readonly events: WorkyEventService,
    private readonly audit: WorkyAuditService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WorkyMemoryService.name);
  }

  async propose(input: ProposeInput): Promise<IWorkyMemoryProposalResponse> {
    if (!isObjectId(input.ownerUserId)) {
      throw new Error(`WorkyMemoryService.propose: invalid ownerUserId`);
    }
    if (!VALID_CATEGORIES.has(input.category)) {
      throw new Error(`WorkyMemoryService.propose: invalid category ${input.category}`);
    }
    if (input.sourceStreamId && !isObjectId(input.sourceStreamId)) {
      throw new Error(`WorkyMemoryService.propose: invalid sourceStreamId`);
    }
    const proposal = await this.memories.createProposal({
      ownerUserId: input.ownerUserId,
      sourceStreamId: input.sourceStreamId || null,
      category: input.category,
      title: input.title,
      content: input.content,
    });
    this.events.emit(input.ownerUserId, input.sourceStreamId ?? '', {
      type: 'memory.proposed',
      emittedAt: Date.now(),
      payload: {
        proposalId: proposal.id,
        category: input.category,
        title: input.title,
      },
    });
    await this.audit.append({
      streamId: input.sourceStreamId ?? input.ownerUserId,
      actorUserId: input.ownerUserId,
      action: 'memory.proposed',
      targetType: 'worky_memory_proposal',
      targetId: proposal.id,
      details: { category: input.category, title: input.title },
    });
    this.logger.log('Worky memory proposal created', {
      proposalId: proposal.id,
      ownerUserId: input.ownerUserId,
      category: input.category,
    });
    return this.toProposalResponse(proposal);
  }

  async confirm(input: { proposalId: string; actorUserId: string }): Promise<IWorkyMemoryEntryResponse> {
    if (!isObjectId(input.proposalId)) {
      throw new Error(`WorkyMemoryService.confirm: invalid proposalId`);
    }
    const proposal = await this.findProposalOrThrow('confirm', input.proposalId);
    if (proposal.status !== 'pending') return this.alreadyDecided(proposal);
    const confirmed = await this.memories.confirm(proposal.id);
    if (!confirmed) {
      // Decided concurrently: answer as if this call had come second.
      return this.alreadyDecided(await this.findProposalOrThrow('confirm', input.proposalId));
    }
    const { proposal: decided, entry } = confirmed;
    this.events.emit(decided.ownerUserId, decided.sourceStreamId ?? '', {
      type: 'memory.confirmed',
      emittedAt: Date.now(),
      payload: {
        proposalId: decided.id,
        entryId: entry.id,
        category: decided.category,
      },
    });
    await this.audit.append({
      streamId: decided.sourceStreamId ?? decided.ownerUserId,
      actorUserId: input.actorUserId,
      action: 'memory.confirmed',
      targetType: 'worky_memory_entry',
      targetId: entry.id,
      details: { proposalId: decided.id, category: decided.category },
    });
    return this.toEntryResponse(entry);
  }

  async reject(input: { proposalId: string; actorUserId: string; reason?: string }): Promise<IWorkyMemoryProposalResponse> {
    if (!isObjectId(input.proposalId)) {
      throw new Error(`WorkyMemoryService.reject: invalid proposalId`);
    }
    const proposal = await this.findProposalOrThrow('reject', input.proposalId);
    if (proposal.status !== 'pending') throw this.cannotReject(proposal);
    const rejected = await this.memories.reject(proposal.id);
    if (!rejected) {
      // Decided concurrently: answer as if this call had come second.
      throw this.cannotReject(await this.findProposalOrThrow('reject', input.proposalId));
    }
    this.events.emit(rejected.ownerUserId, rejected.sourceStreamId ?? '', {
      type: 'memory.rejected',
      emittedAt: Date.now(),
      payload: {
        proposalId: rejected.id,
        reason: input.reason ?? null,
      },
    });
    await this.audit.append({
      streamId: rejected.sourceStreamId ?? rejected.ownerUserId,
      actorUserId: input.actorUserId,
      action: 'memory.rejected',
      targetType: 'worky_memory_proposal',
      targetId: rejected.id,
      details: { reason: input.reason ?? null },
    });
    return this.toProposalResponse(rejected);
  }

  async findProposals(
    ownerUserId: string,
    status?: 'pending' | 'confirmed' | 'rejected',
  ): Promise<IWorkyMemoryProposalResponse[]> {
    if (!isObjectId(ownerUserId)) return [];
    const proposals = await this.memories.listProposals(ownerUserId, status, 100);
    return proposals.map((p) => this.toProposalResponse(p));
  }

  async findForOwner(ownerUserId: string): Promise<IWorkyMemoryEntryResponse[]> {
    if (!isObjectId(ownerUserId)) return [];
    const entries = await this.memories.listEntries(ownerUserId, 200);
    return entries.map((e) => this.toEntryResponse(e));
  }

  private async findProposalOrThrow(method: 'confirm' | 'reject', proposalId: string): Promise<WorkyMemoryProposalRecord> {
    const proposal = await this.memories.findProposal(proposalId);
    if (!proposal) {
      throw new Error(`WorkyMemoryService.${method}: proposal ${proposalId} not found`);
    }
    return proposal;
  }

  /** Idempotent confirm: the existing entry if already confirmed, otherwise an error. */
  private async alreadyDecided(proposal: WorkyMemoryProposalRecord): Promise<IWorkyMemoryEntryResponse> {
    if (proposal.status === 'confirmed') {
      const entry = await this.memories.findEntryByProposal(proposal.id);
      if (entry) return this.toEntryResponse(entry);
    }
    throw new Error(
      `WorkyMemoryService.confirm: proposal is in status ${proposal.status}, cannot confirm`,
    );
  }

  private cannotReject(proposal: WorkyMemoryProposalRecord): Error {
    return new Error(
      `WorkyMemoryService.reject: proposal is in status ${proposal.status}, cannot reject`,
    );
  }

  private toProposalResponse(row: WorkyMemoryProposalRecord): IWorkyMemoryProposalResponse {
    return {
      id: row.id,
      ownerUserId: row.ownerUserId,
      sourceStreamId: row.sourceStreamId,
      category: row.category,
      title: row.title,
      content: row.content,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toEntryResponse(row: WorkyMemoryEntryRecord): IWorkyMemoryEntryResponse {
    return {
      id: row.id,
      ownerUserId: row.ownerUserId,
      category: row.category,
      title: row.title,
      content: row.content,
      sourceStreamId: row.sourceStreamId,
      sourceProposalId: row.sourceProposalId,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
