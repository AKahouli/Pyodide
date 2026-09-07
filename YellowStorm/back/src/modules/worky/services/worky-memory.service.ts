import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  WorkyMemoryProposal,
  WorkyMemoryProposalDocument,
  WorkyMemoryEntry,
  WorkyMemoryEntryDocument,
} from '../schemas/worky-memory.schema';
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
 *   - `propose(input)`  creates a `WorkyMemoryProposal` row, emits
 *     `memory.proposed`. The runtime / frontend can present the
 *     proposal to the owner.
 *   - `confirm(id)`     transitions the proposal to `confirmed` and
 *     creates a `WorkyMemoryEntry` (the durable record). Emits
 *     `memory.confirmed`. The runtime can pull the new entry via
 *     `findForOwner`.
 *   - `reject(id)`      transitions the proposal to `rejected`. NO
 *     `WorkyMemoryEntry` is created. Emits `memory.rejected`.
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
    @InjectModel(WorkyMemoryProposal.name)
    private readonly proposals: Model<WorkyMemoryProposalDocument>,
    @InjectModel(WorkyMemoryEntry.name)
    private readonly entries: Model<WorkyMemoryEntryDocument>,
    private readonly events: WorkyEventService,
    private readonly audit: WorkyAuditService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WorkyMemoryService.name);
  }

  async propose(input: ProposeInput): Promise<IWorkyMemoryProposalResponse> {
    if (!Types.ObjectId.isValid(input.ownerUserId)) {
      throw new Error(`WorkyMemoryService.propose: invalid ownerUserId`);
    }
    if (!VALID_CATEGORIES.has(input.category)) {
      throw new Error(`WorkyMemoryService.propose: invalid category ${input.category}`);
    }
    if (input.sourceStreamId && !Types.ObjectId.isValid(input.sourceStreamId)) {
      throw new Error(`WorkyMemoryService.propose: invalid sourceStreamId`);
    }
    const doc = await this.proposals.create({
      ownerUserId: new Types.ObjectId(input.ownerUserId),
      sourceStreamId: input.sourceStreamId
        ? new Types.ObjectId(input.sourceStreamId)
        : null,
      category: input.category,
      title: input.title,
      content: input.content,
      status: 'pending',
    });
    this.events.emit(input.ownerUserId, input.sourceStreamId ?? '', {
      type: 'memory.proposed',
      emittedAt: Date.now(),
      payload: {
        proposalId: doc._id.toString(),
        category: input.category,
        title: input.title,
      },
    });
    await this.audit.append({
      streamId: input.sourceStreamId ?? input.ownerUserId,
      actorUserId: input.ownerUserId,
      action: 'memory.proposed',
      targetType: 'worky_memory_proposal',
      targetId: doc._id.toString(),
      details: { category: input.category, title: input.title },
    });
    this.logger.log('Worky memory proposal created', {
      proposalId: doc._id.toString(),
      ownerUserId: input.ownerUserId,
      category: input.category,
    });
    return this.toProposalResponse(doc);
  }

  async confirm(input: { proposalId: string; actorUserId: string }): Promise<IWorkyMemoryEntryResponse> {
    if (!Types.ObjectId.isValid(input.proposalId)) {
      throw new Error(`WorkyMemoryService.confirm: invalid proposalId`);
    }
    const proposal = await this.proposals.findById(input.proposalId).exec();
    if (!proposal) {
      throw new Error(`WorkyMemoryService.confirm: proposal ${input.proposalId} not found`);
    }
    if (proposal.status !== 'pending') {
      // Idempotent: return the existing entry if already confirmed,
      // or throw on rejected.
      if (proposal.status === 'confirmed') {
        const entry = await this.entries.findOne({ sourceProposalId: proposal._id }).exec();
        if (entry) return this.toEntryResponse(entry);
      }
      throw new Error(
        `WorkyMemoryService.confirm: proposal is in status ${proposal.status}, cannot confirm`,
      );
    }
    proposal.status = 'confirmed';
    proposal.decidedAt = new Date();
    await proposal.save();
    const entry = await this.entries.create({
      ownerUserId: proposal.ownerUserId,
      sourceProposalId: proposal._id,
      sourceStreamId: proposal.sourceStreamId,
      category: proposal.category,
      title: proposal.title,
      content: proposal.content,
    });
    this.events.emit(proposal.ownerUserId.toString(), proposal.sourceStreamId?.toString() ?? '', {
      type: 'memory.confirmed',
      emittedAt: Date.now(),
      payload: {
        proposalId: proposal._id.toString(),
        entryId: entry._id.toString(),
        category: proposal.category,
      },
    });
    await this.audit.append({
      streamId: proposal.sourceStreamId?.toString() ?? proposal.ownerUserId.toString(),
      actorUserId: input.actorUserId,
      action: 'memory.confirmed',
      targetType: 'worky_memory_entry',
      targetId: entry._id.toString(),
      details: { proposalId: proposal._id.toString(), category: proposal.category },
    });
    return this.toEntryResponse(entry);
  }

  async reject(input: { proposalId: string; actorUserId: string; reason?: string }): Promise<IWorkyMemoryProposalResponse> {
    if (!Types.ObjectId.isValid(input.proposalId)) {
      throw new Error(`WorkyMemoryService.reject: invalid proposalId`);
    }
    const proposal = await this.proposals.findById(input.proposalId).exec();
    if (!proposal) {
      throw new Error(`WorkyMemoryService.reject: proposal ${input.proposalId} not found`);
    }
    if (proposal.status !== 'pending') {
      throw new Error(
        `WorkyMemoryService.reject: proposal is in status ${proposal.status}, cannot reject`,
      );
    }
    proposal.status = 'rejected';
    proposal.decidedAt = new Date();
    await proposal.save();
    this.events.emit(proposal.ownerUserId.toString(), proposal.sourceStreamId?.toString() ?? '', {
      type: 'memory.rejected',
      emittedAt: Date.now(),
      payload: {
        proposalId: proposal._id.toString(),
        reason: input.reason ?? null,
      },
    });
    await this.audit.append({
      streamId: proposal.sourceStreamId?.toString() ?? proposal.ownerUserId.toString(),
      actorUserId: input.actorUserId,
      action: 'memory.rejected',
      targetType: 'worky_memory_proposal',
      targetId: proposal._id.toString(),
      details: { reason: input.reason ?? null },
    });
    return this.toProposalResponse(proposal);
  }

  async findProposals(
    ownerUserId: string,
    status?: 'pending' | 'confirmed' | 'rejected',
  ): Promise<IWorkyMemoryProposalResponse[]> {
    if (!Types.ObjectId.isValid(ownerUserId)) return [];
    const filter: Record<string, unknown> = { ownerUserId: new Types.ObjectId(ownerUserId) };
    if (status) filter.status = status;
    const docs = await this.proposals
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .exec();
    return docs.map((d) => this.toProposalResponse(d));
  }

  async findForOwner(ownerUserId: string): Promise<IWorkyMemoryEntryResponse[]> {
    if (!Types.ObjectId.isValid(ownerUserId)) return [];
    const docs = await this.entries
      .find({ ownerUserId: new Types.ObjectId(ownerUserId) })
      .sort({ createdAt: -1 })
      .limit(200)
      .exec();
    return docs.map((d) => this.toEntryResponse(d));
  }

  private toProposalResponse(doc: WorkyMemoryProposalDocument): IWorkyMemoryProposalResponse {
    return {
      id: doc._id.toString(),
      ownerUserId: doc.ownerUserId.toString(),
      sourceStreamId: doc.sourceStreamId ? doc.sourceStreamId.toString() : null,
      category: doc.category,
      title: doc.title,
      content: doc.content,
      status: doc.status,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  private toEntryResponse(doc: WorkyMemoryEntryDocument): IWorkyMemoryEntryResponse {
    return {
      id: doc._id.toString(),
      ownerUserId: doc.ownerUserId.toString(),
      category: doc.category,
      title: doc.title,
      content: doc.content,
      sourceStreamId: doc.sourceStreamId ? doc.sourceStreamId.toString() : null,
      sourceProposalId: doc.sourceProposalId ? doc.sourceProposalId.toString() : null,
      createdAt: doc.createdAt.toISOString(),
    };
  }
}
