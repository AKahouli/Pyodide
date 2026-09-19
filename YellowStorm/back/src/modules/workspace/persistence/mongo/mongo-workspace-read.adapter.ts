import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Workspace, type WorkspaceDocument } from '../../schemas/workspace.schema';
import { WORKSPACE_READ_PORT, type WorkspaceReadPort } from '../../ports/workspace-read.port';
import type { WorkspaceRecord } from '../../ports/workspace-records';

@Injectable()
export class MongoWorkspaceReadAdapter implements WorkspaceReadPort {
  constructor(@InjectModel(Workspace.name) private readonly workspaceModel: Model<WorkspaceDocument>) {}

  async findById(id: string): Promise<WorkspaceRecord | null> {
    const doc = await this.workspaceModel.findById(id).lean().exec();
    return doc ? workspaceToRecord(doc) : null;
  }

  async findByIds(ids: string[]): Promise<Map<string, WorkspaceRecord>> {
    const map = new Map<string, WorkspaceRecord>();
    if (ids.length === 0) return map;
    const docs = await this.workspaceModel.find({ _id: { $in: ids } }).lean().exec();
    for (const doc of docs) {
      const record = workspaceToRecord(doc);
      map.set(record.id, record);
    }
    return map;
  }

  async exists(id: string): Promise<boolean> {
    const found = await this.workspaceModel.exists({ _id: id }).exec();
    return Boolean(found);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function workspaceToRecord(doc: any): WorkspaceRecord {
  return {
    id: String(doc._id),
    name: doc.name,
    alias: doc.alias,
    storagePrefix: doc.storagePrefix,
    description: doc.description ?? undefined,
    createdBy: String(doc.createdBy),
    settingsId: doc.settings ? String(doc.settings) : undefined,
    documentCount: doc.documentCount ?? 0,
    usedStorage: doc.usedStorage ?? 0,
    allocatedStorage: doc.allocatedStorage ?? 0,
    isSystem: Boolean(doc.isSystem),
    isPersonal: Boolean(doc.isPersonal),
    shareCount: doc.shareCount ?? 0,
    isPublic: Boolean(doc.isPublic),
    conversationId: doc.conversationId ? String(doc.conversationId) : undefined,
    createdAt: new Date(doc.createdAt),
    updatedAt: new Date(doc.updatedAt),
  };
}
