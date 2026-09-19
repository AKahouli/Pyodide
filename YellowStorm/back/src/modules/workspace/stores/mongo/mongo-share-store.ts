import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { WorkspaceShare, WorkspaceShareDocument } from '../../schemas/workspace-share.schema';
import { SHARE_STORE, type ShareStore, type ShareCreateInput, type SharePage } from '../share-store';
import type { WorkspaceShareRecord } from '../../ports/workspace-records';
import { shareDocToRecord, toObjectId } from './mongo-store-mappers';

@Injectable()
export class MongoShareStore implements ShareStore {
  constructor(
    @InjectModel(WorkspaceShare.name)
    private readonly shareModel: Model<WorkspaceShareDocument>,
  ) {}

  async findById(shareId: string): Promise<WorkspaceShareRecord | null> {
    const share = await this.shareModel.findById(shareId).exec();
    return share ? shareDocToRecord(share) : null;
  }

  async findForWorkspace(workspaceId: string, skip: number, limit: number): Promise<SharePage> {
    const [shares, total] = await Promise.all([
      this.shareModel
        .find({ workspaceId: toObjectId(workspaceId) })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.shareModel.countDocuments({
        workspaceId: toObjectId(workspaceId),
      }),
    ]);
    return { items: shares.map(shareDocToRecord), total };
  }

  async findSharedWithUser(userId: string, skip: number, limit: number): Promise<SharePage> {
    const query = { sharedWithUserId: new Types.ObjectId(userId) };
    const [shares, total] = await Promise.all([
      this.shareModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.shareModel.countDocuments(query),
    ]);
    return { items: shares.map((s) => shareDocToRecord(s as WorkspaceShareDocument)), total };
  }

  async findOneByWorkspaceAndUser(workspaceId: string, userId: string): Promise<WorkspaceShareRecord | null> {
    const share = await this.shareModel
      .findOne({
        workspaceId: toObjectId(workspaceId),
        sharedWithUserId: new Types.ObjectId(userId),
      })
      .lean()
      .exec();
    return share ? shareDocToRecord(share as WorkspaceShareDocument) : null;
  }

  async filterSharedWithUser(userId: string, ids: string[]): Promise<string[]> {
    const objectIds = ids.map((id) => new Types.ObjectId(id));
    const shares = await this.shareModel
      .find({ workspaceId: { $in: objectIds }, sharedWithUserId: new Types.ObjectId(userId) })
      .select('workspaceId')
      .lean()
      .exec();
    return shares.map((s) => s.workspaceId.toString());
  }

  async create(input: ShareCreateInput): Promise<WorkspaceShareRecord> {
    const share = await this.shareModel.create({
      workspaceId: toObjectId(input.workspaceId),
      ownerId: new Types.ObjectId(input.ownerId),
      sharedWithUserId: new Types.ObjectId(input.sharedWithUserId),
      permission: input.permission,
      sharedBy: new Types.ObjectId(input.sharedBy),
    });
    return shareDocToRecord(share);
  }

  async updatePermission(shareId: string, permission: 'read' | 'readwrite'): Promise<void> {
    await this.shareModel
      .updateOne({ _id: shareId }, { $set: { permission } })
      .exec();
  }

  async deleteById(shareId: string): Promise<void> {
    await this.shareModel.deleteOne({ _id: shareId });
  }

  async deleteManyByWorkspace(workspaceId: string): Promise<number> {
    const result = await this.shareModel
      .deleteMany({ workspaceId: toObjectId(workspaceId) })
      .exec();
    return result.deletedCount;
  }
}
