import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { newObjectId } from '@common/postgres';
import { UserGroup, UserGroupDocument } from '../schemas/user-group.schema';
import type { PopulatedGroupRecord, UserGroupStore } from './user-group.store';

type AnyDoc = Record<string, unknown>;
const MEMBER_POPULATE = { path: 'members', select: 'email profile.firstName profile.lastName' };

/** Mongo `user_groups` implementation (behavior-preserving). */
export class MongoUserGroupStore implements UserGroupStore {
  constructor(@InjectModel(UserGroup.name) private readonly groupModel: Model<UserGroupDocument>) {}

  async create(init: { ownerId: string; name: string; description: string; memberIds: string[] }): Promise<PopulatedGroupRecord> {
    const created = await this.groupModel.create({
      _id: new Types.ObjectId(newObjectId()),
      name: init.name,
      description: init.description,
      members: init.memberIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id)),
      createdBy: new Types.ObjectId(init.ownerId),
    });
    const populated = await this.groupModel.findById(created._id).populate(MEMBER_POPULATE).lean().exec();
    return toPopulated(populated as unknown as AnyDoc);
  }

  async existsOwnedByName(ownerId: string, name: string, excludeId?: string): Promise<boolean> {
    const filter: Record<string, unknown> = { name, createdBy: new Types.ObjectId(ownerId) };
    if (excludeId && Types.ObjectId.isValid(excludeId)) filter._id = { $ne: new Types.ObjectId(excludeId) };
    const count = await this.groupModel.countDocuments(filter).exec();
    return count > 0;
  }

  async findAllForUser(ownerId: string): Promise<PopulatedGroupRecord[]> {
    const docs = await this.groupModel
      .find({ createdBy: new Types.ObjectId(ownerId) })
      .populate(MEMBER_POPULATE)
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return docs.map((d) => toPopulated(d as unknown as AnyDoc));
  }

  async findOwnedById(ownerId: string, id: string): Promise<PopulatedGroupRecord | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await this.groupModel.findById(id).populate(MEMBER_POPULATE).lean().exec();
    if (!doc || String((doc as unknown as AnyDoc).createdBy) !== ownerId) return null;
    return toPopulated(doc as unknown as AnyDoc);
  }

  async findOwnedByIds(ownerId: string, ids: string[]): Promise<PopulatedGroupRecord[]> {
    const valid = [...new Set(ids)].filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    if (valid.length === 0) return [];
    const docs = await this.groupModel
      .find({ _id: { $in: valid }, createdBy: new Types.ObjectId(ownerId) })
      .populate(MEMBER_POPULATE)
      .lean()
      .exec();
    return docs.map((d) => toPopulated(d as unknown as AnyDoc));
  }

  async update(id: string, patch: { name?: string; description?: string }): Promise<void> {
    if (!Types.ObjectId.isValid(id)) return;
    await this.groupModel.updateOne({ _id: new Types.ObjectId(id) }, { $set: patch }).exec();
  }

  async deleteById(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) return;
    await this.groupModel.deleteOne({ _id: new Types.ObjectId(id) }).exec();
  }

  async addMembers(id: string, userIds: string[]): Promise<void> {
    if (!Types.ObjectId.isValid(id)) return;
    const objectIds = [...new Set(userIds)].filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x));
    if (objectIds.length === 0) return;
    await this.groupModel
      .updateOne({ _id: new Types.ObjectId(id) }, { $addToSet: { members: { $each: objectIds } } })
      .exec();
  }

  async removeMember(id: string, memberId: string): Promise<void> {
    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(memberId)) return;
    await this.groupModel
      .updateOne({ _id: new Types.ObjectId(id) }, { $pull: { members: new Types.ObjectId(memberId) } })
      .exec();
  }

  async findOwnedGroupIdsForMember(ownerId: string, memberId: string): Promise<string[]> {
    if (!Types.ObjectId.isValid(memberId)) return [];
    const docs = await this.groupModel
      .find({ createdBy: new Types.ObjectId(ownerId), members: new Types.ObjectId(memberId) })
      .select('_id')
      .lean()
      .exec();
    return docs.map((d) => String(d._id));
  }

  async findGroupIdsForMember(memberId: string): Promise<string[]> {
    if (!Types.ObjectId.isValid(memberId)) return [];
    const docs = await this.groupModel.find({ members: new Types.ObjectId(memberId) }).select('_id').lean().exec();
    return docs.map((d) => String(d._id));
  }
}

function toPopulated(doc: AnyDoc): PopulatedGroupRecord {
  const rawMembers = (doc.members as unknown[]) ?? [];
  return {
    id: String(doc._id),
    name: doc.name as string,
    description: (doc.description as string) || '',
    createdBy: String(doc.createdBy),
    members: rawMembers
      // A ref to a deleted user populates as null — drop it (populate parity).
      .filter((m): m is AnyDoc => m !== null && typeof m === 'object' && '_id' in m)
      .map((m) => {
        const profile = (m.profile as { firstName?: string; lastName?: string } | undefined) ?? {};
        return {
          id: String(m._id),
          email: (m.email as string) ?? '',
          firstName: profile.firstName ?? null,
          lastName: profile.lastName ?? null,
        };
      }),
    createdAt: doc.createdAt as Date,
    updatedAt: doc.updatedAt as Date,
  };
}
