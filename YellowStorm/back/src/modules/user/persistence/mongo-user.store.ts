import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { newObjectId, normalizeObjectId } from '@common/postgres';
import { User, UserDocument } from '../schemas/user.schema';
import {
  AdminUserFilter,
  NewUser,
  RoleRef,
  UserPatch,
  UserRecord,
  UserRecordWithRoles,
  UserSearchHit,
  UserStore,
} from './user.store';
import { escapeRegex } from '@common/utils';
import { toSearchHit } from './user-record.mapper';

type AnyStatus = 'active' | 'inactive' | 'suspended';
type AnyApproval = 'pending' | 'approved' | 'rejected';

/**
 * Mongo `users` implementation of UserStore — behavior-preserving until the
 * 1A cutover. Role population relies on the Role model being registered by
 * AuthorizationModule (same as the admin controller today).
 */
export class MongoUserStore implements UserStore {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  async findById(id: string): Promise<UserRecord | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await this.userModel.findById(id).exec();
    return doc ? toRecord(doc) : null;
  }

  async findByIds(ids: string[]): Promise<Map<string, UserRecord>> {
    const valid = ids.filter((id) => Types.ObjectId.isValid(id));
    if (valid.length === 0) return new Map();
    const docs = await this.userModel.find({ _id: { $in: valid.map((id) => new Types.ObjectId(id)) } }).exec();
    return new Map(docs.map((doc) => [String(doc._id), toRecord(doc)]));
  }

  async findByIdWithRoles(id: string): Promise<UserRecordWithRoles | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await this.userModel.findById(id).populate('roles', 'name').exec();
    return doc ? { ...toRecord(doc), roles: toRoleRefs(doc) } : null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const doc = await this.userModel.findOne({ email: email.toLowerCase() }).exec();
    return doc ? toRecord(doc) : null;
  }

  async findByEmails(emails: string[]): Promise<Map<string, UserRecord>> {
    const normalized = emails.map((e) => e.toLowerCase());
    if (normalized.length === 0) return new Map();
    const docs = await this.userModel.find({ email: { $in: normalized } }).exec();
    return new Map(docs.map((doc) => [doc.email, toRecord(doc)]));
  }

  async findByVerificationToken(token: string): Promise<UserRecord | null> {
    const doc = await this.userModel.findOne({ emailVerificationToken: token }).select('+emailVerificationToken').exec();
    return doc ? toRecord(doc) : null;
  }

  async findByResetTokenHash(tokenHash: string): Promise<UserRecord | null> {
    const doc = await this.userModel.findOne({ passwordResetToken: tokenHash }).select('+passwordResetToken').exec();
    return doc ? toRecord(doc) : null;
  }

  async findByMicrosoftAccountId(microsoftAccountId: string): Promise<UserRecord | null> {
    const doc = await this.userModel.findOne({ microsoftAccountId }).exec();
    return doc ? toRecord(doc) : null;
  }

  async existsByEmail(email: string): Promise<boolean> {
    const count = await this.userModel.countDocuments({ email: email.toLowerCase() }).exec();
    return count > 0;
  }

  async create(init: NewUser): Promise<UserRecord> {
    const created = await this.userModel.create({
      _id: new Types.ObjectId(newObjectId()),
      email: init.email.toLowerCase(),
      passwordHash: init.passwordHash,
      emailVerified: init.emailVerified ?? false,
      ...(init.emailVerificationToken !== undefined && { emailVerificationToken: init.emailVerificationToken }),
      ...(init.emailVerificationExpiry !== undefined && { emailVerificationExpiry: init.emailVerificationExpiry }),
      profile: {
        ...(init.firstName !== undefined && { firstName: init.firstName }),
        ...(init.lastName !== undefined && { lastName: init.lastName }),
        ...(init.company !== undefined && { company: init.company }),
        role: init.profileRole ?? '',
        description: init.description ?? '',
      },
      ...(init.microsoftAccountId !== undefined && { microsoftAccountId: init.microsoftAccountId }),
      ...(init.profileComplete !== undefined && { profileComplete: init.profileComplete }),
      status: init.status ?? 'active',
      ...(init.registrationApproval !== undefined && { registrationApproval: init.registrationApproval }),
      ...(init.roleIds !== undefined && { roles: init.roleIds.map((id) => new Types.ObjectId(id)) }),
    });
    return toRecord(created);
  }

  async update(id: string, patch: UserPatch): Promise<UserRecord | null> {
    const set: Record<string, unknown> = {};
    const unset: Record<string, string> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) {
        unset[USER_PATCH_TO_PATH[key] ?? key] = '';
      } else if (value !== undefined) {
        set[USER_PATCH_TO_PATH[key] ?? key] = value;
      }
    }
    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(unset).length > 0) update.$unset = unset;
    const doc = await this.userModel.findOneAndUpdate({ _id: new Types.ObjectId(normalizeObjectId(id)) }, update, {
      new: true,
    }).exec();
    return doc ? toRecord(doc) : null;
  }

  async searchActive(q: string, options: { excludeUserId?: string; limit: number }): Promise<UserSearchHit[]> {
    const regex = new RegExp(escapeRegex(q.trim()), 'i');
    const filter: Record<string, unknown> = {
      status: 'active',
      $or: [{ email: regex }, { 'profile.firstName': regex }, { 'profile.lastName': regex }],
    };
    if (options.excludeUserId && Types.ObjectId.isValid(options.excludeUserId)) {
      filter._id = { $ne: new Types.ObjectId(options.excludeUserId) };
    }
    const docs = await this.userModel
      .find(filter)
      .select('email profile.firstName profile.lastName')
      .limit(options.limit)
      .exec();
    return docs.map((doc) => toSearchHit(docLean(doc)));
  }

  async listActive(options: { excludeUserId?: string; limit: number }): Promise<UserSearchHit[]> {
    const filter: Record<string, unknown> = { status: 'active' };
    if (options.excludeUserId && Types.ObjectId.isValid(options.excludeUserId)) {
      filter._id = { $ne: new Types.ObjectId(options.excludeUserId) };
    }
    const docs = await this.userModel
      .find(filter)
      .select('email profile.firstName profile.lastName')
      .sort({ email: 1 })
      .limit(options.limit)
      .exec();
    return docs.map((doc) => toSearchHit(docLean(doc)));
  }

  async findWithoutPlan(limit: number): Promise<UserRecord[]> {
    const docs = await this.userModel.find({ planId: { $exists: false } }).limit(limit).exec();
    return docs.map(toRecord);
  }

  async listAdmin(filter: AdminUserFilter): Promise<{ users: UserRecordWithRoles[]; total: number }> {
    const query: Record<string, unknown> = {};
    if (filter.search) {
      const escaped = new RegExp(escapeRegex(filter.search), 'i');
      query.$or = [{ email: escaped }, { 'profile.firstName': escaped }, { 'profile.lastName': escaped }];
    }
    if (filter.status) query.status = filter.status;
    if (filter.emailVerified !== undefined) query.emailVerified = filter.emailVerified;
    if (filter.profileComplete !== undefined) query.profileComplete = filter.profileComplete;
    const sortBy = filter.sortBy ?? 'createdAt';
    const sortOrder = filter.sortOrder === 'asc' ? 1 : -1;
    const limit = filter.limit ?? 20;
    const skip = ((filter.page ?? 1) - 1) * limit;
    const [docs, total] = await Promise.all([
      this.userModel.find(query).sort({ [sortBy]: sortOrder }).skip(skip).limit(limit).populate('roles', 'name').lean().exec(),
      this.userModel.countDocuments(query),
    ]);
    return { users: docs.map((doc) => ({ ...toRecord(doc as unknown as UserDocument), roles: leanRoleRefs(doc) })), total };
  }

  async countByStatus(): Promise<Record<AnyStatus, number>> {
    const rows = await this.userModel.aggregate<{ _id: string; n: number }>([
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]).exec();
    const out: Record<AnyStatus, number> = { active: 0, inactive: 0, suspended: 0 };
    for (const row of rows) out[row._id as AnyStatus] = row.n;
    return out;
  }

  async findActiveByRole(roleId: string): Promise<UserRecord[]> {
    if (!Types.ObjectId.isValid(roleId)) return [];
    const docs = await this.userModel.find({ roles: new Types.ObjectId(roleId), status: 'active' }).exec();
    return docs.map(toRecord);
  }

  async setColorThemeForAll(theme: 'default' | 'yellow' | 'orange' | 'blue'): Promise<void> {
    await this.userModel.updateMany({}, { $set: { 'appearance.colorTheme': theme } }).exec();
  }

  async addRole(userId: string, roleId: string): Promise<void> {
    await this.userModel
      .updateOne(
        { _id: new Types.ObjectId(normalizeObjectId(userId)) },
        { $addToSet: { roles: new Types.ObjectId(roleId) } },
      )
      .exec();
  }

  async removeRole(userId: string, roleId: string): Promise<void> {
    await this.userModel
      .updateOne(
        { _id: new Types.ObjectId(normalizeObjectId(userId)) },
        { $pull: { roles: new Types.ObjectId(roleId) } },
      )
      .exec();
  }

  async removeRoleFromAll(roleId: string): Promise<void> {
    if (!Types.ObjectId.isValid(roleId)) return;
    await this.userModel.updateMany({}, { $pull: { roles: new Types.ObjectId(roleId) } }).exec();
  }

  async bumpPermissionsVersion(userIds: string[]): Promise<void> {
    const valid = userIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    if (valid.length === 0) return;
    await this.userModel
      .updateMany({ _id: { $in: valid } }, { $inc: { permissionsVersion: 1 } })
      .exec();
  }

  async addRoleAndBump(userId: string, roleId: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(roleId)) return;
    await this.userModel
      .findByIdAndUpdate(
        new Types.ObjectId(normalizeObjectId(userId)),
        { $addToSet: { roles: new Types.ObjectId(roleId) }, $inc: { permissionsVersion: 1 } },
      )
      .exec();
  }

  async removeRoleAndBump(userId: string, roleId: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(roleId)) return;
    await this.userModel
      .findByIdAndUpdate(
        new Types.ObjectId(normalizeObjectId(userId)),
        { $pull: { roles: new Types.ObjectId(roleId) }, $inc: { permissionsVersion: 1 } },
      )
      .exec();
  }
}

const USER_PATCH_TO_PATH: Record<string, string> = {
  firstName: 'profile.firstName',
  lastName: 'profile.lastName',
  company: 'profile.company',
  profileRole: 'profile.role',
  description: 'profile.description',
  colorTheme: 'appearance.colorTheme',
  language: 'appearance.language',
  consentPrivacyPolicy: 'consents.privacyPolicy',
  consentPrivacyPolicyAcceptedAt: 'consents.privacyPolicyAcceptedAt',
  consentDataSharing: 'consents.dataSharing',
  consentDataSharingAcceptedAt: 'consents.dataSharingAcceptedAt',
};

/** Flatten a hydrated Mongo user document into the storage-neutral record. */
export function toRecord(doc: UserDocument): UserRecord {
  return {
    id: String(doc._id),
    email: doc.email,
    passwordHash: doc.passwordHash,
    emailVerified: doc.emailVerified,
    emailVerificationToken: doc.emailVerificationToken ?? null,
    emailVerificationExpiry: doc.emailVerificationExpiry ?? null,
    passwordResetToken: doc.passwordResetToken ?? null,
    passwordResetExpiry: doc.passwordResetExpiry ?? null,
    firstName: doc.profile?.firstName ?? null,
    lastName: doc.profile?.lastName ?? null,
    company: doc.profile?.company ?? null,
    profileRole: doc.profile?.role ?? '',
    description: doc.profile?.description ?? '',
    colorTheme: doc.appearance?.colorTheme ?? 'default',
    language: doc.appearance?.language ?? 'en',
    consentPrivacyPolicy: doc.consents?.privacyPolicy ?? false,
    consentPrivacyPolicyAcceptedAt: doc.consents?.privacyPolicyAcceptedAt ?? null,
    consentDataSharing: doc.consents?.dataSharing ?? false,
    consentDataSharingAcceptedAt: doc.consents?.dataSharingAcceptedAt ?? null,
    profileComplete: doc.profileComplete,
    microsoftAccountId: doc.microsoftAccountId ?? null,
    planId: doc.planId ? String(doc.planId) : null,
    planSlug: doc.planSlug ?? null,
    planStartedAt: doc.planStartedAt ?? null,
    roleIds: (doc.roles ?? []).map((r) => String(r)),
    permissionsVersion: doc.permissionsVersion,
    status: doc.status as AnyStatus,
    registrationApproval: (doc.registrationApproval ?? null) as AnyApproval | null,
    lastLoginAt: doc.lastLoginAt ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** Same flattening for lean() results (plain objects, no document getters). */
function docLean(doc: { _id: unknown; email: string; profile?: { firstName?: string; lastName?: string } }): { id: string; email: string; firstName: string | null; lastName: string | null } {
  return { id: String(doc._id), email: doc.email, firstName: doc.profile?.firstName ?? null, lastName: doc.profile?.lastName ?? null };
}

function toRoleRefs(doc: UserDocument): RoleRef[] {
  const roles = doc.roles as unknown as Array<{ _id: unknown; name?: string } | Types.ObjectId>;
  return roles.map((r) =>
    r instanceof Types.ObjectId || !(r as { name?: string }).name
      ? { id: String(r), name: '' }
      : { id: String((r as { _id: unknown })._id ?? r), name: (r as { name: string }).name },
  );
}

function leanRoleRefs(doc: Record<string, unknown>): RoleRef[] {
  const roles = (doc.roles ?? []) as Array<{ _id: unknown; name?: string }>;
  return roles.map((r) => ({ id: String(r._id), name: r.name ?? '' }));
}
