import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { Workspace, WorkspaceDocument } from '../../schemas/workspace.schema';
import { escapeRegex } from '../../../../common/utils';
import { WORKSPACE_STORE, type WorkspaceStore, type WorkspaceCreateInput, type WorkspaceListParams, type WorkspaceListPublicParams, type WorkspaceUpdatePatch, type WorkspaceCounterDelta } from '../workspace-store';
import type { WorkspaceRecord } from '../../ports/workspace-records';
import { toObjectId, workspaceDocToRecord } from './mongo-store-mappers';

@Injectable()
export class MongoWorkspaceStore implements WorkspaceStore {
  constructor(
    @InjectModel(Workspace.name)
    private readonly workspaceModel: Model<WorkspaceDocument>,
  ) {}

  async backfillStoragePrefixFromAlias(): Promise<number> {
    const result = await this.workspaceModel.updateMany(
      { storagePrefix: { $exists: false } },
      [{ $set: { storagePrefix: '$alias' } }],
    );
    return result.modifiedCount;
  }

  async countNonSystemByOwner(userId: string): Promise<number> {
    return this.workspaceModel.countDocuments({
      createdBy: new Types.ObjectId(userId),
      isSystem: { $ne: true },
    });
  }

  async findByName(ownerId: string, name: string, excludeWorkspaceId?: string): Promise<WorkspaceRecord | null> {
    const query: Record<string, unknown> = {
      createdBy: new Types.ObjectId(ownerId),
      name,
    };
    if (excludeWorkspaceId) {
      query._id = { $ne: new Types.ObjectId(excludeWorkspaceId) };
    }
    const existing = await this.workspaceModel.findOne(query);
    return existing ? workspaceDocToRecord(existing) : null;
  }

  async findByOwnerAndAlias(userId: string, alias: string, excludeWorkspaceId?: string): Promise<WorkspaceRecord | null> {
    const query: Record<string, unknown> = {
      createdBy: new Types.ObjectId(userId),
      alias,
    };
    if (excludeWorkspaceId) {
      query._id = { $ne: new Types.ObjectId(excludeWorkspaceId) };
    }
    const existing = await this.workspaceModel.findOne(query);
    return existing ? workspaceDocToRecord(existing) : null;
  }

  async findByOwnerPersonal(userId: string): Promise<WorkspaceRecord | null> {
    const existing = await this.workspaceModel.findOne({
      createdBy: new Types.ObjectId(userId),
      isPersonal: true,
    });
    return existing ? workspaceDocToRecord(existing) : null;
  }

  async findById(id: string): Promise<WorkspaceRecord | null> {
    const workspace = await this.workspaceModel.findById(id);
    return workspace ? workspaceDocToRecord(workspace) : null;
  }

  async findByIds(ids: string[]): Promise<Map<string, WorkspaceRecord>> {
    const docs = await this.workspaceModel
      .find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
      .lean()
      .exec();
    const map = new Map<string, WorkspaceRecord>();
    for (const doc of docs) {
      map.set(doc._id.toString(), workspaceDocToRecord(doc as WorkspaceDocument));
    }
    return map;
  }

  async filterOwned(ids: string[], userId: string): Promise<string[]> {
    const objectIds = ids.map((id) => new Types.ObjectId(id));
    const docs = await this.workspaceModel
      .find({ _id: { $in: objectIds }, createdBy: new Types.ObjectId(userId) })
      .select('_id')
      .lean()
      .exec();
    return docs.map((w) => w._id.toString());
  }

  async filterPublic(ids: string[]): Promise<string[]> {
    const objectIds = ids.map((id) => new Types.ObjectId(id));
    const docs = await this.workspaceModel
      .find({ _id: { $in: objectIds }, isPublic: true })
      .select('_id')
      .lean()
      .exec();
    return docs.map((w) => w._id.toString());
  }

  async findIdsByOwner(userId: string): Promise<string[]> {
    const docs = await this.workspaceModel
      .find({ createdBy: new Types.ObjectId(userId), isSystem: { $ne: true } })
      .select('_id')
      .lean()
      .exec();
    return docs.map((d) => (d._id as Types.ObjectId).toString());
  }

  async listByUser(userId: string, params: WorkspaceListParams): Promise<{ items: WorkspaceRecord[]; total: number }> {
    const { search, skip, limit, sortBy, sortOrder } = params;
    const query: Record<string, unknown> = {
      createdBy: new Types.ObjectId(userId),
      isSystem: { $ne: true },
    };
    if (search) {
      const escapedSearch = escapeRegex(search);
      query.$or = [
        { name: { $regex: escapedSearch, $options: 'i' } },
        { description: { $regex: escapedSearch, $options: 'i' } },
      ];
    }
    const sort: Record<string, 1 | -1> = {
      isPersonal: -1, // Personal workspace first
      [sortBy]: sortOrder === 'asc' ? 1 : -1,
    };
    const [workspaces, total] = await Promise.all([
      this.workspaceModel.find(query).sort(sort).skip(skip).limit(limit).exec(),
      this.workspaceModel.countDocuments(query),
    ]);
    return { items: workspaces.map(workspaceDocToRecord), total };
  }

  async listPublic(userId: string, params: WorkspaceListPublicParams): Promise<{ items: WorkspaceRecord[]; total: number }> {
    const { search, skip, limit } = params;
    const query: Record<string, unknown> = {
      isPublic: true,
      isSystem: { $ne: true },
      createdBy: { $ne: new Types.ObjectId(userId) },
    };
    if (search) {
      const escaped = escapeRegex(search);
      query.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { description: { $regex: escaped, $options: 'i' } },
      ];
    }
    const [workspaces, total] = await Promise.all([
      this.workspaceModel
        .find(query)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.workspaceModel.countDocuments(query).exec(),
    ]);
    return { items: workspaces.map((ws) => workspaceDocToRecord(ws as WorkspaceDocument)), total };
  }

  async create(input: WorkspaceCreateInput): Promise<WorkspaceRecord> {
    const workspace = await this.workspaceModel.create({
      name: input.name,
      alias: input.alias,
      storagePrefix: input.storagePrefix,
      description: input.description,
      createdBy: toObjectId(input.createdBy),
      settings: input.settingsId ? new Types.ObjectId(input.settingsId) : undefined,
      documentCount: input.documentCount ?? 0,
      usedStorage: input.usedStorage ?? 0,
      allocatedStorage: input.allocatedStorage,
      isSystem: input.isSystem,
      isPersonal: input.isPersonal,
      conversationId: input.conversationId
        ? Types.ObjectId.isValid(input.conversationId)
          ? new Types.ObjectId(input.conversationId)
          : null
        : undefined,
    });
    return workspaceDocToRecord(workspace);
  }

  async updateFields(id: string, patch: WorkspaceUpdatePatch): Promise<void> {
    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.alias !== undefined) set.alias = patch.alias;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.settingsId !== undefined) {
      set.settings = patch.settingsId ? new Types.ObjectId(patch.settingsId) : null;
    }
    if (patch.isPublic !== undefined) set.isPublic = patch.isPublic;
    if (Object.keys(set).length > 0) {
      await this.workspaceModel.updateOne({ _id: new Types.ObjectId(id) }, { $set: set });
    }
  }

  async incrementCounters(id: string, delta: WorkspaceCounterDelta): Promise<void> {
    const inc: Record<string, number> = {};
    if (delta.usedStorage !== undefined) inc.usedStorage = delta.usedStorage;
    if (delta.documentCount !== undefined) inc.documentCount = delta.documentCount;
    if (delta.shareCount !== undefined) inc.shareCount = delta.shareCount;
    if (Object.keys(inc).length > 0) {
      await this.workspaceModel.findByIdAndUpdate(id, { $inc: inc });
    }
  }

  async deleteById(id: string): Promise<void> {
    await this.workspaceModel.deleteOne({ _id: id });
  }

  async findSystemWorkspace(userId: string, conversationId: string): Promise<WorkspaceRecord | null> {
    const workspace = await this.workspaceModel.findOne({
      name: `system-${conversationId}`,
      createdBy: new Types.ObjectId(userId),
      isSystem: true,
    });
    return workspace ? workspaceDocToRecord(workspace) : null;
  }

  async deleteSystemWorkspace(id: string): Promise<void> {
    await this.workspaceModel.deleteOne({
      _id: new Types.ObjectId(id),
      isSystem: true,
    });
  }
}
