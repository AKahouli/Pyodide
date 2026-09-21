import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { newObjectId } from '@common/postgres';
import { AuthProvider, AuthProviderDocument } from '../schemas/auth-provider.schema';
import { OAuthState, OAuthStateDocument } from '../schemas/oauth-state.schema';
import { ProviderLinkToken, ProviderLinkTokenDocument } from '../schemas/provider-link-token.schema';
import { UserProviderLink, UserProviderLinkDocument } from '../schemas/user-provider-link.schema';
import type {
  AuthProviderRecord,
  AuthProviderStore,
  OAuthStateRecord,
  OAuthStateStore,
  ProviderLinkTokenRecord,
  ProviderLinkTokenStore,
  UserProviderLinkRecord,
  UserProviderLinkStore,
} from './auth-provider.stores';

type AnyDoc = Record<string, unknown>;
const oidOrNull = (v: unknown): string | null => (v == null ? null : String(v));

/** Mongo implementations of the auth-provider stores (behavior-preserving). */
export class MongoAuthProviderStore implements AuthProviderStore {
  constructor(@InjectModel(AuthProvider.name) private readonly model: Model<AuthProviderDocument>) {}

  async findAll(): Promise<AuthProviderRecord[]> {
    const docs = await this.model.find().sort({ sortOrder: 1 }).exec();
    return docs.map((d) => toProviderRecord(d as unknown as AnyDoc));
  }

  async findAllEnabled(): Promise<AuthProviderRecord[]> {
    const docs = await this.model.find({ enabled: true }).sort({ sortOrder: 1 }).exec();
    return docs.map((d) => toProviderRecord(d as unknown as AnyDoc));
  }

  async findById(id: string): Promise<AuthProviderRecord | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await this.model.findById(id).exec();
    return doc ? toProviderRecord(doc as unknown as AnyDoc) : null;
  }

  async findByKey(providerKey: string): Promise<AuthProviderRecord | null> {
    const doc = await this.model.findOne({ providerKey }).exec();
    return doc ? toProviderRecord(doc as unknown as AnyDoc) : null;
  }

  async existsByKey(providerKey: string, excludeId?: string): Promise<boolean> {
    const filter: Record<string, unknown> = { providerKey };
    if (excludeId && Types.ObjectId.isValid(excludeId)) filter._id = { $ne: new Types.ObjectId(excludeId) };
    const count = await this.model.countDocuments(filter).exec();
    return count > 0;
  }

  async create(init: Omit<AuthProviderRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<AuthProviderRecord> {
    const created = await this.model.create({ ...init, _id: new Types.ObjectId(newObjectId()) });
    return toProviderRecord(created as unknown as AnyDoc);
  }

  async update(id: string, patch: Record<string, unknown>): Promise<AuthProviderRecord | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await this.model.findByIdAndUpdate(id, { $set: patch }, { new: true }).exec();
    return doc ? toProviderRecord(doc as unknown as AnyDoc) : null;
  }

  async deleteById(id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const result = await this.model.deleteOne({ _id: new Types.ObjectId(id) }).exec();
    return result.deletedCount > 0;
  }
}

function toProviderRecord(doc: AnyDoc): AuthProviderRecord {
  return {
    id: String(doc._id),
    providerKey: doc.providerKey as string,
    displayName: doc.displayName as string,
    clientId: doc.clientId as string,
    clientSecret: doc.clientSecret as string,
    tenantId: (doc.tenantId as string) ?? null,
    authorizationUrl: doc.authorizationUrl as string,
    tokenUrl: doc.tokenUrl as string,
    userinfoUrl: doc.userinfoUrl as string,
    scopes: (doc.scopes as string[]) ?? [],
    iconKey: (doc.iconKey as string) ?? null,
    sortOrder: (doc.sortOrder as number) ?? 0,
    pkceEnabled: doc.pkceEnabled as boolean,
    enabled: doc.enabled as boolean,
    createdAt: doc.createdAt as Date,
    updatedAt: doc.updatedAt as Date,
  };
}

export class MongoOAuthStateStore implements OAuthStateStore {
  constructor(@InjectModel(OAuthState.name) private readonly model: Model<OAuthStateDocument>) {}

  async create(init: Omit<OAuthStateRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<OAuthStateRecord> {
    const created = await this.model.create({ ...init, _id: new Types.ObjectId(newObjectId()) });
    return toStateRecord(created as unknown as AnyDoc);
  }

  async consumeByState(state: string): Promise<OAuthStateRecord | null> {
    const doc = await this.model.findOneAndDelete({ state, expiresAt: { $gt: new Date() } }).exec();
    return doc ? toStateRecord(doc as unknown as AnyDoc) : null;
  }
}

function toStateRecord(doc: AnyDoc): OAuthStateRecord {
  return {
    id: String(doc._id),
    state: doc.state as string,
    providerKey: doc.providerKey as string,
    codeVerifier: (doc.codeVerifier as string) ?? null,
    returnUrl: (doc.returnUrl as string) ?? null,
    expiresAt: doc.expiresAt as Date,
    createdAt: doc.createdAt as Date,
    updatedAt: doc.updatedAt as Date,
  };
}

export class MongoProviderLinkTokenStore implements ProviderLinkTokenStore {
  constructor(@InjectModel(ProviderLinkToken.name) private readonly model: Model<ProviderLinkTokenDocument>) {}

  async create(init: Omit<ProviderLinkTokenRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProviderLinkTokenRecord> {
    const created = await this.model.create({ ...init, _id: new Types.ObjectId(newObjectId()) });
    return toTokenRecord(created as unknown as AnyDoc);
  }

  async consumeByToken(token: string): Promise<ProviderLinkTokenRecord | null> {
    const doc = await this.model.findOneAndDelete({ token, expiresAt: { $gt: new Date() } }).exec();
    return doc ? toTokenRecord(doc as unknown as AnyDoc) : null;
  }

  async consumeByTokenAndProviderKey(token: string, providerKey: string): Promise<ProviderLinkTokenRecord | null> {
    const doc = await this.model
      .findOneAndDelete({ token, providerKey, expiresAt: { $gt: new Date() } })
      .exec();
    return doc ? toTokenRecord(doc as unknown as AnyDoc) : null;
  }
}

function toTokenRecord(doc: AnyDoc): ProviderLinkTokenRecord {
  return {
    id: String(doc._id),
    token: doc.token as string,
    userId: String(doc.userId),
    providerKey: doc.providerKey as string,
    providerUserId: doc.providerUserId as string,
    providerEmail: doc.providerEmail as string,
    expiresAt: doc.expiresAt as Date,
    createdAt: doc.createdAt as Date,
    updatedAt: doc.updatedAt as Date,
  };
}

export class MongoUserProviderLinkStore implements UserProviderLinkStore {
  constructor(@InjectModel(UserProviderLink.name) private readonly model: Model<UserProviderLinkDocument>) {}

  async findByProvider(providerKey: string, providerUserId: string): Promise<UserProviderLinkRecord | null> {
    const doc = await this.model.findOne({ providerKey, providerUserId }).exec();
    return doc ? toLinkRecord(doc as unknown as AnyDoc) : null;
  }

  async findByUserId(userId: string): Promise<UserProviderLinkRecord[]> {
    if (!Types.ObjectId.isValid(userId)) return [];
    const docs = await this.model.find({ userId: new Types.ObjectId(userId) }).exec();
    return docs.map((d) => toLinkRecord(d as unknown as AnyDoc));
  }

  async create(init: Omit<UserProviderLinkRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<UserProviderLinkRecord> {
    const created = await this.model.create({ ...init, _id: new Types.ObjectId(newObjectId()) });
    return toLinkRecord(created as unknown as AnyDoc);
  }

  async deleteByUserAndProvider(userId: string, providerKey: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(userId)) return false;
    const result = await this.model
      .deleteOne({ userId: new Types.ObjectId(userId), providerKey })
      .exec();
    return result.deletedCount > 0;
  }

  async countByUserExcluding(userId: string, providerKey: string): Promise<number> {
    if (!Types.ObjectId.isValid(userId)) return 0;
    return this.model
      .countDocuments({ userId: new Types.ObjectId(userId), providerKey: { $ne: providerKey } })
      .exec();
  }

  async countByProviderKey(providerKey: string): Promise<number> {
    return this.model.countDocuments({ providerKey }).exec();
  }

  async deleteAllByProviderKey(providerKey: string): Promise<number> {
    const result = await this.model.deleteMany({ providerKey }).exec();
    return result.deletedCount;
  }
}

function toLinkRecord(doc: AnyDoc): UserProviderLinkRecord {
  return {
    id: String(doc._id),
    userId: oidOrNull(doc.userId) ?? '',
    providerKey: doc.providerKey as string,
    providerUserId: doc.providerUserId as string,
    providerEmail: doc.providerEmail as string,
    linkedAt: (doc.linkedAt as Date) ?? (doc.createdAt as Date),
    createdAt: doc.createdAt as Date,
    updatedAt: doc.updatedAt as Date,
  };
}
