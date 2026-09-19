import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { GovernanceMembership, GovernanceMembershipDocument } from './schemas/governance-membership.schema';
import { MEMBERSHIP_STORE, type GovernanceMembershipCreateInput, type GovernanceMembershipPatch, type MembershipStore } from '../membership-store';
import { DuplicateKeyError, type GovernanceMembershipRecord } from '../governance-records';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export function membershipToRecord(doc: Row): GovernanceMembershipRecord {
  return {
    id: doc._id.toString(),
    programId: doc.programId.toString(),
    scopeId: doc.scopeId?.toString(),
    userId: doc.userId?.toString(),
    groupId: doc.groupId?.toString(),
    invitedBy: doc.invitedBy.toString(),
    role: doc.role,
    status: doc.status,
    permissions: doc.permissions ?? [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function objectIdOrNull(value: string | null | undefined): Types.ObjectId | undefined {
  return value ? new Types.ObjectId(value) : undefined;
}

@Injectable()
export class MongoMembershipStore implements MembershipStore {
  constructor(@InjectModel(GovernanceMembership.name) private readonly model: Model<GovernanceMembershipDocument>) {}

  async insert(input: GovernanceMembershipCreateInput): Promise<GovernanceMembershipRecord> {
    try {
      const created = await this.model.create({
        programId: new Types.ObjectId(input.programId),
        scopeId: objectIdOrNull(input.scopeId),
        userId: objectIdOrNull(input.userId),
        groupId: objectIdOrNull(input.groupId),
        invitedBy: new Types.ObjectId(input.invitedBy),
        role: input.role,
        status: input.status,
        permissions: input.permissions,
      });
      return membershipToRecord(created);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === 11000) {
        throw new DuplicateKeyError('membership already exists');
      }
      throw error;
    }
  }

  async findById(membershipId: string): Promise<GovernanceMembershipRecord | null> {
    const found = await this.model.findById(membershipId).exec();
    return found ? membershipToRecord(found) : null;
  }

  async findByIdAndProgram(programId: string, membershipId: string): Promise<GovernanceMembershipRecord | null> {
    const found = await this.model.findOne({ _id: new Types.ObjectId(membershipId), programId: new Types.ObjectId(programId) }).exec();
    return found ? membershipToRecord(found) : null;
  }

  async findDuplicate(programId: string, scopeId: string | null, target: { userId?: string; groupId?: string }): Promise<GovernanceMembershipRecord | null> {
    const targetFilter = target.userId ? { userId: new Types.ObjectId(target.userId) } : { groupId: new Types.ObjectId(target.groupId) };
    const found = await this.model.findOne({ programId: new Types.ObjectId(programId), scopeId: scopeId ? new Types.ObjectId(scopeId) : null, ...targetFilter }).exec();
    return found ? membershipToRecord(found) : null;
  }

  async findActiveForUser(programId: string, userId: string, groupIds: string[]): Promise<GovernanceMembershipRecord[]> {
    const memberships = await this.model
      .find({
        programId: new Types.ObjectId(programId),
        status: 'active',
        $or: [
          { userId: new Types.ObjectId(userId) },
          ...(groupIds.length > 0 ? [{ groupId: { $in: groupIds.map((id) => new Types.ObjectId(id)) } }] : []),
        ],
      })
      .lean()
      .exec();
    return memberships.map(membershipToRecord);
  }

  async findActiveByUser(userId: string): Promise<GovernanceMembershipRecord[]> {
    const memberships = await this.model.find({ userId: new Types.ObjectId(userId), status: 'active' }).select('programId').lean().exec();
    return memberships.map(membershipToRecord);
  }

  async listByProgram(programId: string): Promise<GovernanceMembershipRecord[]> {
    const memberships = await this.model.find({ programId: new Types.ObjectId(programId) }).sort({ createdAt: -1 }).lean().exec();
    return memberships.map(membershipToRecord);
  }

  async countByProgram(programId: string): Promise<number> {
    return this.model.countDocuments({ programId: new Types.ObjectId(programId) });
  }

  async update(membershipId: string, patch: GovernanceMembershipPatch): Promise<GovernanceMembershipRecord | null> {
    const membership = await this.model.findById(membershipId).exec();
    if (!membership) return null;
    if (patch.scopeId !== undefined) membership.scopeId = objectIdOrNull(patch.scopeId);
    if (patch.role !== undefined) membership.role = patch.role;
    if (patch.status !== undefined) membership.status = patch.status;
    if (patch.permissions !== undefined) membership.permissions = patch.permissions;
    if (patch.invitedBy !== undefined) membership.invitedBy = new Types.ObjectId(patch.invitedBy);
    await membership.save();
    return membershipToRecord(membership);
  }

  async deleteById(membershipId: string): Promise<void> {
    await this.model.deleteOne({ _id: new Types.ObjectId(membershipId) }).exec();
  }

  async deleteByProgramAndScope(programId: string, scopeId: string): Promise<void> {
    await this.model.deleteMany({ programId: new Types.ObjectId(programId), scopeId: new Types.ObjectId(scopeId) }).exec();
  }
}
