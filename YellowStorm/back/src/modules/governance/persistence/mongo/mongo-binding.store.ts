import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { GovernanceWorkspaceBinding, GovernanceWorkspaceBindingDocument } from './schemas/governance-workspace-binding.schema';
import { BINDING_STORE, type GovernanceBindingCreateInput, type GovernanceBindingPatch, type BindingStore } from '../binding-store';
import { DuplicateKeyError, type GovernanceBindingRecord } from '../governance-records';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export function bindingToRecord(doc: Row): GovernanceBindingRecord {
  return {
    id: doc._id.toString(),
    programId: doc.programId.toString(),
    workspaceId: doc.workspaceId.toString(),
    visibility: doc.visibility,
    scopeIds: (doc.scopeIds ?? []).map((id: Types.ObjectId) => id.toString()),
    enabled: doc.enabled,
    ingestionMode: doc.ingestionMode,
    defaults: doc.defaults ?? {},
    createdBy: doc.createdBy.toString(),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === 11000;
}

@Injectable()
export class MongoBindingStore implements BindingStore {
  constructor(@InjectModel(GovernanceWorkspaceBinding.name) private readonly model: Model<GovernanceWorkspaceBindingDocument>) {}

  async insert(input: GovernanceBindingCreateInput): Promise<GovernanceBindingRecord> {
    try {
      const created = await this.model.create({
        ...input,
        programId: new Types.ObjectId(input.programId),
        workspaceId: new Types.ObjectId(input.workspaceId),
        scopeIds: input.scopeIds.map((id) => new Types.ObjectId(id)),
        createdBy: new Types.ObjectId(input.createdBy),
      });
      return bindingToRecord(created);
    } catch (error) {
      if (isDuplicateKey(error)) throw new DuplicateKeyError('Workspace is already bound to this program');
      throw error;
    }
  }

  async findByProgramAndWorkspace(programId: string, workspaceId: string): Promise<GovernanceBindingRecord | null> {
    const found = await this.model.findOne({ programId: new Types.ObjectId(programId), workspaceId: new Types.ObjectId(workspaceId) }).exec();
    return found ? bindingToRecord(found) : null;
  }

  async findById(bindingId: string): Promise<GovernanceBindingRecord | null> {
    const found = await this.model.findById(bindingId).exec();
    return found ? bindingToRecord(found) : null;
  }

  async findByIdAndProgram(programId: string, bindingId: string): Promise<GovernanceBindingRecord | null> {
    const found = await this.model.findOne({ _id: new Types.ObjectId(bindingId), programId: new Types.ObjectId(programId) }).exec();
    return found ? bindingToRecord(found) : null;
  }

  async existsByIdAndProgram(programId: string, bindingId: string): Promise<boolean> {
    const found = await this.model.exists({ _id: new Types.ObjectId(bindingId), programId: new Types.ObjectId(programId) });
    return Boolean(found);
  }

  async listByProgram(programId: string): Promise<GovernanceBindingRecord[]> {
    const bindings = await this.model.find({ programId: new Types.ObjectId(programId) }).sort({ createdAt: -1 }).exec();
    return bindings.map(bindingToRecord);
  }

  async listEnabledForWorkspace(workspaceId: string): Promise<GovernanceBindingRecord[]> {
    const bindings = await this.model.find({ workspaceId: new Types.ObjectId(workspaceId), enabled: true }).exec();
    return bindings.map(bindingToRecord);
  }

  async listEnabled(programId: string, scopeIds: string[] | '*'): Promise<GovernanceBindingRecord[]> {
    const filter: Record<string, unknown> = { programId: new Types.ObjectId(programId), enabled: true };
    if (scopeIds !== '*') {
      filter.$or = [{ visibility: 'program_shared' }, { scopeIds: { $in: scopeIds.map((id) => new Types.ObjectId(id)) } }];
    }
    const bindings = await this.model.find(filter).exec();
    return bindings.map(bindingToRecord);
  }

  async update(bindingId: string, patch: GovernanceBindingPatch): Promise<GovernanceBindingRecord | null> {
    const binding = await this.model.findById(bindingId).exec();
    if (!binding) return null;
    if (patch.enabled !== undefined) binding.enabled = patch.enabled;
    if (patch.ingestionMode !== undefined) binding.ingestionMode = patch.ingestionMode;
    if (patch.defaults !== undefined) binding.defaults = patch.defaults as never;
    await binding.save();
    return bindingToRecord(binding);
  }


  async replaceScopeIds(bindingId: string, scopeIds: string[], visibility: GovernanceBindingRecord['visibility']): Promise<GovernanceBindingRecord | null> {
    const binding = await this.model.findById(bindingId).exec();
    if (!binding) return null;
    binding.scopeIds = scopeIds.map((id) => new Types.ObjectId(id));
    binding.visibility = visibility;
    await binding.save();
    return bindingToRecord(binding);
  }

  async deleteById(bindingId: string): Promise<void> {
    await this.model.deleteOne({ _id: new Types.ObjectId(bindingId) }).exec();
  }

  async filterWorkspaceIdsBoundToScope(programId: string, workspaceIds: string[], scopeId: string): Promise<string[]> {
    const matched = await this.model.distinct('workspaceId', {
      programId: new Types.ObjectId(programId),
      workspaceId: { $in: workspaceIds.map((id) => new Types.ObjectId(id)) },
      enabled: true,
      $or: [{ scopeIds: new Types.ObjectId(scopeId) }, { visibility: 'program_shared' }],
    }).exec();
    return matched.map(String);
  }

  async countByProgram(programId: string): Promise<number> {
    return this.model.countDocuments({ programId: new Types.ObjectId(programId) });
  }

  async removeScopeFromProgramBindings(programId: string, scopeId: string): Promise<void> {
    const programObjectId = new Types.ObjectId(programId);
    const scopeObjectId = new Types.ObjectId(scopeId);
    await this.model.deleteMany({ programId: programObjectId, visibility: 'multi_scope', scopeIds: { $size: 1, $all: [scopeObjectId] } }).exec();
    await this.model.deleteMany({ programId: programObjectId, visibility: 'scope_specific', scopeIds: scopeObjectId }).exec();
    await this.model
      .updateMany(
        { programId: programObjectId, visibility: 'multi_scope', scopeIds: scopeObjectId },
        [
          { $set: { scopeIds: { $filter: { input: '$scopeIds', as: 'scopeId', cond: { $ne: ['$$scopeId', scopeObjectId] } } } } },
          { $set: { visibility: { $cond: [{ $eq: [{ $size: '$scopeIds' }, 1] }, 'scope_specific', 'multi_scope'] } } },
        ],
      )
      .exec();
  }
}
