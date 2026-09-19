import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { GovernanceScope, GovernanceScopeDocument } from './schemas/governance-scope.schema';
import { SCOPE_STORE, type GovernanceScopeCreateInput, type GovernanceScopePatch, type ScopeStore } from '../scope-store';
import type { GovernanceScopeRecord } from '../governance-records';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export function scopeToRecord(doc: Row): GovernanceScopeRecord {
  const audience = doc.audience ?? {};
  const knowledge = doc.knowledge ?? {};
  return {
    id: doc._id.toString(),
    programId: doc.programId.toString(),
    parentScopeId: doc.parentScopeId?.toString(),
    name: doc.name,
    type: doc.type,
    status: doc.status,
    agentIds: (doc.agentIds ?? []).map((id: Types.ObjectId) => id.toString()),
    audience: {
      mode: audience.mode ?? 'restricted',
      userIds: (audience.userIds ?? []).map(String),
      groupIds: (audience.groupIds ?? []).map(String),
    },
    knowledge: {
      sourceMode: knowledge.sourceMode ?? 'llm_only',
      webSourcesEnabled: knowledge.webSourcesEnabled ?? false,
      webAllowedDomains: knowledge.webAllowedDomains ?? [],
      webBlockedDomains: knowledge.webBlockedDomains ?? [],
    },
    metadata: doc.metadata ?? {},
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toObjectIdOrNull(value: string | null | undefined): Types.ObjectId | undefined {
  return value ? new Types.ObjectId(value) : undefined;
}

@Injectable()
export class MongoScopeStore implements ScopeStore {
  constructor(@InjectModel(GovernanceScope.name) private readonly model: Model<GovernanceScopeDocument>) {}

  async insert(input: GovernanceScopeCreateInput): Promise<GovernanceScopeRecord> {
    const created = await this.model.create({
      ...input,
      name: input.name,
      programId: new Types.ObjectId(input.programId),
      parentScopeId: toObjectIdOrNull(input.parentScopeId),
      agentIds: (input.agentIds ?? []).map((id) => new Types.ObjectId(id)),
      audience: input.audience
        ? {
            mode: input.audience.mode,
            userIds: input.audience.userIds.map((id) => new Types.ObjectId(id)),
            groupIds: input.audience.groupIds.map((id) => new Types.ObjectId(id)),
          }
        : undefined,
    });
    return scopeToRecord(created);
  }

  async findById(scopeId: string): Promise<GovernanceScopeRecord | null> {
    const found = await this.model.findById(scopeId).lean().exec();
    return found ? scopeToRecord(found) : null;
  }

  async findByProgramAndId(programId: string, scopeId: string): Promise<GovernanceScopeRecord | null> {
    const found = await this.model.findOne({ _id: new Types.ObjectId(scopeId), programId: new Types.ObjectId(programId) }).lean().exec();
    return found ? scopeToRecord(found) : null;
  }

  async listByProgram(programId: string, scopeIds: string[] | '*'): Promise<GovernanceScopeRecord[]> {
    const filter = scopeIds === '*' ? { programId: new Types.ObjectId(programId) } : { programId: new Types.ObjectId(programId), _id: { $in: scopeIds.map((id) => new Types.ObjectId(id)) } };
    const scopes = await this.model.find(filter).sort({ createdAt: 1 }).lean().exec();
    return scopes.map(scopeToRecord);
  }


  async listActive(): Promise<GovernanceScopeRecord[]> {
    const scopes = await this.model.find({ status: 'active' }).select('programId name type metadata audience').lean().exec();
    return scopes.map(scopeToRecord);
  }

  async listChildIds(programId: string, parentScopeId: string): Promise<string[]> {
    const children = await this.model
      .find({ programId: new Types.ObjectId(programId), parentScopeId: new Types.ObjectId(parentScopeId) })
      .select('_id')
      .lean()
      .exec();
    return children.map((child) => child._id.toString());
  }

  async update(scopeId: string, patch: GovernanceScopePatch): Promise<GovernanceScopeRecord | null> {
    const scope = await this.model.findOne({ _id: new Types.ObjectId(scopeId) }).exec();
    if (!scope) return null;
    if (patch.name !== undefined) scope.name = patch.name;
    if (patch.parentScopeId !== undefined) scope.parentScopeId = toObjectIdOrNull(patch.parentScopeId);
    if (patch.type !== undefined) scope.type = patch.type;
    if (patch.status !== undefined) scope.status = patch.status;
    if (patch.agentIds !== undefined) scope.agentIds = patch.agentIds.map((id) => new Types.ObjectId(id));
    if (patch.audience !== undefined) {
      scope.audience = {
        mode: patch.audience.mode,
        userIds: patch.audience.userIds.map((id) => new Types.ObjectId(id)),
        groupIds: patch.audience.groupIds.map((id) => new Types.ObjectId(id)),
      } as never;
    }
    if (patch.knowledge !== undefined) scope.knowledge = patch.knowledge as never;
    if (patch.metadata !== undefined) scope.metadata = patch.metadata;
    await scope.save();
    return scopeToRecord(scope);
  }

  async setMetadataReviewStatus(scopeId: string, status: string): Promise<void> {
    await this.model.updateOne({ _id: new Types.ObjectId(scopeId) }, { $set: { 'metadata.review.status': status } }).exec();
  }

  async countByProgram(programId: string): Promise<number> {
    return this.model.countDocuments({ programId: new Types.ObjectId(programId) });
  }

  async deleteByIdAndProgram(scopeId: string, programId: string): Promise<void> {
    await this.model.deleteOne({ _id: new Types.ObjectId(scopeId), programId: new Types.ObjectId(programId) }).exec();
  }
}
