import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { newObjectId } from '@common/postgres';
import { Role, RoleDocument } from '../schemas/role.schema';
import { AuditLog, AuditLogDocument } from '../schemas/audit-log.schema';
import { User, UserDocument } from '../../user/schemas/user.schema';
import type { RolePatch, RoleRecord, RoleStore } from './role.store';
import type { AuditLogQuery, AuditLogRecord, AuditLogStore } from './audit-log.store';
import { escapeRegex } from '@common/utils';

type AnyDoc = Record<string, unknown>;

function toRoleRecord(doc: AnyDoc): RoleRecord {
  return {
    id: String(doc._id),
    name: doc.name as string,
    description: doc.description as string,
    permissions: (doc.permissions as string[]) ?? [],
    isActive: doc.isActive as boolean,
    isSystem: doc.isSystem as boolean,
    priority: (doc.priority as number) ?? 0,
    createdAt: doc.createdAt as Date,
    updatedAt: doc.updatedAt as Date,
  };
}

/** Mongo `roles` implementation (behavior-preserving). */
export class MongoRoleStore implements RoleStore {
  constructor(
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async findAll(): Promise<RoleRecord[]> {
    const docs = await this.roleModel.find().sort({ priority: -1, name: 1 }).exec();
    return docs.map((d) => toRoleRecord(d as unknown as AnyDoc));
  }

  async findAllActive(): Promise<RoleRecord[]> {
    const docs = await this.roleModel.find({ isActive: true }).sort({ priority: -1, name: 1 }).exec();
    return docs.map((d) => toRoleRecord(d as unknown as AnyDoc));
  }

  async findById(id: string): Promise<RoleRecord | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await this.roleModel.findById(id).exec();
    return doc ? toRoleRecord(doc as unknown as AnyDoc) : null;
  }

  async findByIds(ids: string[]): Promise<Map<string, RoleRecord>> {
    const valid = ids.filter((id) => Types.ObjectId.isValid(id));
    if (valid.length === 0) return new Map();
    const docs = await this.roleModel
      .find({ _id: { $in: valid.map((id) => new Types.ObjectId(id)) } })
      .exec();
    return new Map(docs.map((d) => [String(d._id), toRoleRecord(d as unknown as AnyDoc)]));
  }

  async findByName(name: string): Promise<RoleRecord | null> {
    const doc = await this.roleModel.findOne({ name: name.toLowerCase() }).exec();
    return doc ? toRoleRecord(doc as unknown as AnyDoc) : null;
  }

  async create(init: { name: string; description: string; permissions: string[]; isSystem?: boolean; priority?: number; isActive?: boolean }): Promise<RoleRecord> {
    const created = await this.roleModel.create({
      _id: new Types.ObjectId(newObjectId()),
      name: init.name.toLowerCase(),
      description: init.description,
      permissions: init.permissions,
      ...(init.isSystem !== undefined && { isSystem: init.isSystem }),
      ...(init.priority !== undefined && { priority: init.priority }),
      ...(init.isActive !== undefined && { isActive: init.isActive }),
    });
    return toRoleRecord(created as unknown as AnyDoc);
  }

  async update(id: string, patch: RolePatch): Promise<RoleRecord | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await this.roleModel.findByIdAndUpdate(id, { $set: { ...patch, ...(patch.name !== undefined && { name: patch.name.toLowerCase() }) } }, { new: true }).exec();
    return doc ? toRoleRecord(doc as unknown as AnyDoc) : null;
  }

  async deleteByIdAndDetach(id: string): Promise<RoleRecord | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const objectId = new Types.ObjectId(id);
    const mongoSession = await this.roleModel.db.startSession();
    try {
      let deleted: RoleRecord | null = null;
      await mongoSession.withTransaction(async () => {
        await this.userModel
          .updateMany({ roles: objectId }, { $pull: { roles: objectId }, $inc: { permissionsVersion: 1 } })
          .session(mongoSession);
        const doc = await this.roleModel.findByIdAndDelete(objectId).session(mongoSession);
        deleted = doc ? toRoleRecord(doc as unknown as AnyDoc) : null;
      });
      return deleted;
    } finally {
      await mongoSession.endSession();
    }
  }

  async ensureDefaults(roles: Array<{ name: string; description: string; permissions: string[]; isSystem?: boolean; priority?: number }>): Promise<void> {
    for (const role of roles) {
      const existing = await this.roleModel.findOne({ name: role.name }).exec();
      if (!existing) {
        await this.roleModel.create({
          _id: new Types.ObjectId(newObjectId()),
          name: role.name,
          description: role.description,
          permissions: role.permissions,
          isSystem: role.isSystem ?? true,
          priority: role.priority ?? 0,
        });
      }
    }
  }
}

function toAuditRecord(doc: AnyDoc): AuditLogRecord {
  return {
    id: String(doc._id),
    actorId: String(doc.actorId),
    actorEmail: doc.actorEmail as string,
    action: doc.action as string,
    targetId: doc.targetId ? String(doc.targetId) : null,
    targetType: (doc.targetType as string) ?? null,
    metadata: (doc.metadata as Record<string, unknown>) ?? null,
    ipAddress: (doc.ipAddress as string) ?? null,
    userAgent: (doc.userAgent as string) ?? null,
    status: doc.status as 'success' | 'failure',
    failureReason: (doc.failureReason as string) ?? null,
    createdAt: doc.createdAt as Date,
  };
}

/** Mongo `audit_logs` implementation (behavior-preserving). */
export class MongoAuditLogStore implements AuditLogStore {
  constructor(@InjectModel(AuditLog.name) private readonly auditLogModel: Model<AuditLogDocument>) {}

  async insert(record: Omit<AuditLogRecord, 'id' | 'createdAt'>): Promise<void> {
    await this.auditLogModel.create({
      _id: new Types.ObjectId(newObjectId()),
      actorId: new Types.ObjectId(record.actorId),
      actorEmail: record.actorEmail,
      action: record.action,
      ...(record.targetId !== null && { targetId: new Types.ObjectId(record.targetId) }),
      ...(record.targetType !== null && { targetType: record.targetType }),
      ...(record.metadata !== null && { metadata: record.metadata }),
      ...(record.ipAddress !== null && { ipAddress: record.ipAddress }),
      ...(record.userAgent !== null && { userAgent: record.userAgent }),
      status: record.status,
      ...(record.failureReason !== null && { failureReason: record.failureReason }),
    });
  }

  async findAll(query: AuditLogQuery): Promise<{ logs: AuditLogRecord[]; total: number; hasMore: boolean }> {
    const filter: Record<string, unknown> = {};
    if (query.actorId && Types.ObjectId.isValid(query.actorId)) filter.actorId = new Types.ObjectId(query.actorId);
    if (query.actorEmail) filter.actorEmail = { $regex: escapeRegex(query.actorEmail), $options: 'i' };
    if (query.action) filter.action = query.action;
    if (query.feature) filter.action = { $regex: `^${escapeRegex(query.feature)}\\.`, $options: 'i' };
    if (query.targetId && Types.ObjectId.isValid(query.targetId)) filter.targetId = new Types.ObjectId(query.targetId);
    if (query.targetType) filter.targetType = query.targetType;
    if (query.status) filter.status = query.status;
    if (query.startDate || query.endDate) {
      const createdAt: Record<string, Date> = {};
      if (query.startDate) createdAt.$gte = query.startDate;
      if (query.endDate) createdAt.$lte = query.endDate;
      filter.createdAt = createdAt;
    }
    const limit = query.limit ?? 50;
    const skip = query.skip ?? 0;
    const [docs, total] = await Promise.all([
      this.auditLogModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
      this.auditLogModel.countDocuments(filter).exec(),
    ]);
    return { logs: docs.map((d) => toAuditRecord(d as unknown as AnyDoc)), total, hasMore: skip + docs.length < total };
  }

  async getDistinctActions(): Promise<string[]> {
    return this.auditLogModel.distinct('action').exec();
  }
}
