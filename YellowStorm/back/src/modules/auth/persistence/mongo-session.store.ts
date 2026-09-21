import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { newObjectId } from '@common/postgres';
import { Session, SessionDocument } from '../schemas/session.schema';
import { User, UserDocument } from '../../user/schemas/user.schema';
import { toRecord as toUserRecord } from '../../user/persistence/mongo-user.store';
import {
  NewSession,
  RotationBookkeeping,
  RotationConflictError,
  SESSION_STORE,
  SessionRecord,
  SessionStore,
} from './session.store';

type AnyDoc = Record<string, unknown>;

/** Mongo `sessions` implementation of SessionStore (behavior-preserving). */
export class MongoSessionStore implements SessionStore {
  constructor(
    @InjectModel(Session.name) private readonly sessionModel: Model<SessionDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async create(init: NewSession): Promise<SessionRecord> {
    const created = await this.sessionModel.create({
      _id: new Types.ObjectId(init.id ?? newObjectId()),
      userId: new Types.ObjectId(init.userId),
      refreshTokenHash: init.refreshTokenHash,
      deviceInfo: init.deviceInfo,
      ipAddress: init.ipAddress,
      expiresAt: init.expiresAt,
      tokenFamily: init.tokenFamily,
      lastActivityAt: init.lastActivityAt,
      ...(init.rotatedFromSessionId !== undefined && { rotatedFromSessionId: new Types.ObjectId(init.rotatedFromSessionId) }),
    });
    return toRecord(created as unknown as AnyDoc);
  }

  async findById(id: string): Promise<SessionRecord | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await this.sessionModel.findById(id).exec();
    return doc ? toRecord(doc as unknown as AnyDoc) : null;
  }

  async findActiveByUserId(userId: string): Promise<SessionRecord[]> {
    const docs = await this.sessionModel
      .find({ userId: new Types.ObjectId(userId), isValid: true, expiresAt: { $gt: new Date() } })
      .sort({ lastActivityAt: -1 })
      .exec();
    return docs.map((doc) => toRecord(doc as unknown as AnyDoc));
  }

  async existsForUserAndIp(userId: string, ipAddress: string): Promise<boolean> {
    const doc = await this.sessionModel.findOne({ userId: new Types.ObjectId(userId), ipAddress }).exec();
    return doc !== null;
  }

  async invalidateById(id: string): Promise<void> {
    await this.sessionModel.updateOne({ _id: new Types.ObjectId(id) }, { $set: { isValid: false } }).exec();
  }

  async invalidateByIdAndUser(userId: string, sessionId: string): Promise<boolean> {
    const result = await this.sessionModel
      .updateOne(
        { _id: new Types.ObjectId(sessionId), userId: new Types.ObjectId(userId) },
        { $set: { isValid: false } },
      )
      .exec();
    return result.matchedCount > 0;
  }

  async invalidateAllForUser(userId: string): Promise<void> {
    await this.sessionModel
      .updateMany({ userId: new Types.ObjectId(userId) }, { $set: { isValid: false } })
      .exec();
  }

  async invalidateByFamily(tokenFamily: string): Promise<void> {
    await this.sessionModel.updateMany({ tokenFamily }, { $set: { isValid: false } }).exec();
  }

  async deleteById(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) return;
    await this.sessionModel.deleteOne({ _id: new Types.ObjectId(id) }).exec();
  }

  async countActiveForUser(userId: string): Promise<number> {
    return this.sessionModel
      .countDocuments({ userId: new Types.ObjectId(userId), isValid: true, expiresAt: { $gt: new Date() } })
      .exec();
  }

  async invalidateOldestBeyond(userId: string, keep: number): Promise<number> {
    const docs = await this.sessionModel
      .find({ userId: new Types.ObjectId(userId), isValid: true })
      .sort({ lastActivityAt: -1 })
      .skip(keep)
      .exec();
    if (docs.length === 0) return 0;
    await this.sessionModel.updateMany(
      { _id: { $in: docs.map((d) => d._id) } },
      { $set: { isValid: false, updatedAt: new Date() } },
    ).exec();
    return docs.length;
  }

  async rotateAtomic(params: {
    predecessorId: string;
    newSession: NewSession;
    bookkeeping: RotationBookkeeping;
  }): Promise<SessionRecord> {
    const mongoSession = await this.sessionModel.db.startSession();
    let successor: SessionRecord | null = null;
    try {
      await mongoSession.withTransaction(async () => {
        // 1. Conditional claim of the predecessor — a consumed one aborts all.
        const claimed = await this.sessionModel.findOneAndUpdate(
          { _id: new Types.ObjectId(params.predecessorId), isValid: true },
          { $set: claimUpdate(params.bookkeeping) },
          { session: mongoSession, new: true },
        );
        if (!claimed) throw new RotationConflictError();
        // 2. Insert the successor (sparse unique rotatedFrom link).
        successor = await this.create(params.newSession);
      });
    } finally {
      await mongoSession.endSession();
    }
    if (!successor) throw new RotationConflictError();
    return successor;
  }

  async findValidByIdWithUser(id: string): Promise<{ session: SessionRecord; user: ReturnType<typeof toUserRecord>; valid: boolean } | null> {
    const session = await this.findById(id);
    if (!session) return null;
    const valid = session.isValid && session.expiresAt > new Date();
    const doc = await this.userModel.findById(session.userId).exec();
    if (!doc) return null;
    return { session, user: toUserRecord(doc), valid };
  }
}

function claimUpdate(bookkeeping: RotationBookkeeping): Record<string, unknown> {
  const set: Record<string, unknown> = {
    isValid: false,
    rotatedAt: bookkeeping.rotatedAt,
    rotatedToSessionId: new Types.ObjectId(bookkeeping.rotatedToSessionId),
  };
  if (bookkeeping.rotationAttemptId) set.rotationAttemptId = bookkeeping.rotationAttemptId;
  if (bookkeeping.receipt) {
    set.rotationReceiptExpiresAt = bookkeeping.receipt.expiresAt;
    set.rotationReceiptKeyId = bookkeeping.receipt.keyId;
    set.rotationReceiptCiphertext = bookkeeping.receipt.ciphertext;
  }
  return set;
}

export function toRecord(doc: AnyDoc): SessionRecord {
  return {
    id: String(doc._id),
    userId: String(doc.userId),
    refreshTokenHash: doc.refreshTokenHash as string,
    deviceInfo: (doc.deviceInfo ?? {}) as Record<string, unknown>,
    ipAddress: doc.ipAddress as string,
    isValid: doc.isValid as boolean,
    expiresAt: doc.expiresAt as Date,
    lastActivityAt: (doc.lastActivityAt as Date) ?? null,
    tokenFamily: doc.tokenFamily as string,
    rotatedFromSessionId: doc.rotatedFromSessionId ? String(doc.rotatedFromSessionId) : null,
    rotatedToSessionId: doc.rotatedToSessionId ? String(doc.rotatedToSessionId) : null,
    rotationAttemptId: (doc.rotationAttemptId as string) ?? null,
    rotatedAt: (doc.rotatedAt as Date) ?? null,
    rotationReceiptExpiresAt: (doc.rotationReceiptExpiresAt as Date) ?? null,
    rotationReceiptCiphertext: (doc.rotationReceiptCiphertext as string) ?? null,
    rotationReceiptKeyId: (doc.rotationReceiptKeyId as string) ?? null,
    createdAt: doc.createdAt as Date,
    updatedAt: doc.updatedAt as Date,
  };
}
