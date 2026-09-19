import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { WorkspaceShare, type WorkspaceShareDocument } from '../../schemas/workspace-share.schema';
import { WORKSPACE_SHARE_READ_PORT, type WorkspaceShareReadPort } from '../../ports/workspace-share-read.port';
import { toObjectId } from './mongo-adapter-utils';
import type { WorkspaceShareRecord } from '../../ports/workspace-records';

@Injectable()
export class MongoWorkspaceShareReadAdapter implements WorkspaceShareReadPort {
  constructor(@InjectModel(WorkspaceShare.name) private readonly shareModel: Model<WorkspaceShareDocument>) {}

  async findForUser(userId: string): Promise<WorkspaceShareRecord[]> {
    const docs = await this.shareModel.find({ sharedWithUserId: toObjectId(userId) }).lean().exec();
    return docs.map(shareToRecord);
  }

  async findForWorkspace(workspaceId: string): Promise<WorkspaceShareRecord[]> {
    const docs = await this.shareModel.find({ workspaceId: toObjectId(workspaceId) }).lean().exec();
    return docs.map(shareToRecord);
  }

  async permissionFor(workspaceId: string, userId: string): Promise<'read' | 'readwrite' | null> {
    const doc = await this.shareModel
      .findOne({ workspaceId: toObjectId(workspaceId), sharedWithUserId: toObjectId(userId) })
      .select({ permission: 1 })
      .lean()
      .exec();
    return (doc?.permission as 'read' | 'readwrite' | undefined) ?? null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shareToRecord(doc: any): WorkspaceShareRecord {
  return {
    id: String(doc._id),
    workspaceId: String(doc.workspaceId),
    ownerId: String(doc.ownerId),
    sharedWithUserId: String(doc.sharedWithUserId),
    permission: doc.permission,
    sharedBy: String(doc.sharedBy),
    createdAt: new Date(doc.createdAt),
    updatedAt: new Date(doc.updatedAt),
  };
}
