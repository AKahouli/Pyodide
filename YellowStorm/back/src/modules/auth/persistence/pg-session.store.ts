import { Inject } from '@nestjs/common';
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { isObjectId, newObjectId } from '@common/postgres';
import { resolveQueryable, withTransaction, type PgQueryable } from '@common/postgres/transaction';
import { isUniqueViolation } from '@common/postgres/errors';
import * as schema from '@modules/postgres/schema';
import type { UserRecord as UserRecordShape } from '@modules/user/persistence/user.store';
import {
  NewSession,
  RotationBookkeeping,
  RotationConflictError,
  SessionRecord,
  SessionStore,
} from './session.store';

type SessionRow = typeof schema.identitySessions.$inferSelect;

/** PostgreSQL identity.sessions implementation of SessionStore (plan 1A.3/1A.4). */
export class PgSessionStore implements SessionStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  private static toRecord(row: SessionRow): SessionRecord {
    return {
      id: row.id,
      userId: row.userId,
      refreshTokenHash: row.refreshTokenHash,
      deviceInfo: row.deviceInfo,
      ipAddress: row.ipAddress,
      isValid: row.isValid,
      expiresAt: row.expiresAt,
      lastActivityAt: row.lastActivityAt,
      tokenFamily: row.tokenFamily,
      rotatedFromSessionId: row.rotatedFromSessionId,
      rotatedToSessionId: row.rotatedToSessionId,
      rotationAttemptId: row.rotationAttemptId,
      rotatedAt: row.rotatedAt,
      rotationReceiptExpiresAt: row.rotationReceiptExpiresAt,
      rotationReceiptCiphertext: row.rotationReceiptCiphertext,
      rotationReceiptKeyId: row.rotationReceiptKeyId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private static insertValues(init: NewSession): typeof schema.identitySessions.$inferInsert {
    return {
      id: init.id ?? newObjectId(),
      userId: init.userId,
      refreshTokenHash: init.refreshTokenHash,
      deviceInfo: init.deviceInfo,
      ipAddress: init.ipAddress,
      expiresAt: init.expiresAt,
      tokenFamily: init.tokenFamily,
      lastActivityAt: init.lastActivityAt ?? null,
      rotatedFromSessionId: init.rotatedFromSessionId ?? null,
    };
  }

  async create(init: NewSession): Promise<SessionRecord> {
    const rows: SessionRow[] = await this.q
      .insert(schema.identitySessions)
      .values(PgSessionStore.insertValues(init))
      .returning();
    return PgSessionStore.toRecord(rows[0]);
  }

  async findById(id: string): Promise<SessionRecord | null> {
    if (!isObjectId(id)) return null;
    const rows: SessionRow[] = await this.q.select().from(schema.identitySessions).where(eq(schema.identitySessions.id, id)).limit(1);
    return rows.length ? PgSessionStore.toRecord(rows[0]) : null;
  }

  async findActiveByUserId(userId: string): Promise<SessionRecord[]> {
    const rows: SessionRow[] = await this.q
      .select()
      .from(schema.identitySessions)
      .where(
        and(
          eq(schema.identitySessions.userId, userId),
          eq(schema.identitySessions.isValid, true),
          gt(schema.identitySessions.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(schema.identitySessions.lastActivityAt));
    return rows.map(PgSessionStore.toRecord);
  }

  async existsForUserAndIp(userId: string, ipAddress: string): Promise<boolean> {
    const rows = await this.q
      .select({ exists: sql<boolean>`true` })
      .from(schema.identitySessions)
      .where(and(eq(schema.identitySessions.userId, userId), eq(schema.identitySessions.ipAddress, ipAddress)))
      .limit(1);
    return rows.length > 0;
  }

  async invalidateById(id: string): Promise<void> {
    if (!isObjectId(id)) return;
    await this.q
      .update(schema.identitySessions)
      .set({ isValid: false, updatedAt: new Date() })
      .where(eq(schema.identitySessions.id, id));
  }

  async invalidateByIdAndUser(userId: string, sessionId: string): Promise<boolean> {
    if (!isObjectId(sessionId) || !isObjectId(userId)) return false;
    const rows: SessionRow[] = await this.q
      .update(schema.identitySessions)
      .set({ isValid: false, updatedAt: new Date() })
      .where(and(eq(schema.identitySessions.id, sessionId), eq(schema.identitySessions.userId, userId)))
      .returning();
    return rows.length > 0;
  }

  async invalidateAllForUser(userId: string): Promise<void> {
    if (!isObjectId(userId)) return;
    await this.q
      .update(schema.identitySessions)
      .set({ isValid: false, updatedAt: new Date() })
      .where(eq(schema.identitySessions.userId, userId));
  }

  async invalidateByFamily(tokenFamily: string): Promise<void> {
    await this.q
      .update(schema.identitySessions)
      .set({ isValid: false, updatedAt: new Date() })
      .where(eq(schema.identitySessions.tokenFamily, tokenFamily));
  }

  async deleteById(id: string): Promise<void> {
    if (!isObjectId(id)) return;
    await this.q.delete(schema.identitySessions).where(eq(schema.identitySessions.id, id));
  }

  async countActiveForUser(userId: string): Promise<number> {
    const rows = await this.q
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.identitySessions)
      .where(
        and(
          eq(schema.identitySessions.userId, userId),
          eq(schema.identitySessions.isValid, true),
          gt(schema.identitySessions.expiresAt, new Date()),
        ),
      );
    return rows[0]?.n ?? 0;
  }

  async findOldestActive(userId: string, limit: number): Promise<SessionRecord[]> {
    const rows: SessionRow[] = await this.q
      .select()
      .from(schema.identitySessions)
      .where(and(eq(schema.identitySessions.userId, userId), eq(schema.identitySessions.isValid, true)))
      .orderBy(asc(schema.identitySessions.lastActivityAt))
      .limit(limit);
    return rows.map(PgSessionStore.toRecord);
  }

  /**
   * Claim (conditional on is_valid) then insert, in one transaction. A claim of
   * zero rows or a unique violation on uq_sessions_rotated_from means a
   * concurrent rotation already won.
   */
  async rotateAtomic(params: {
    predecessorId: string;
    newSession: NewSession;
    bookkeeping: RotationBookkeeping;
  }): Promise<SessionRecord> {
    return withTransaction(this.db, async (tx) => {
      const set: Partial<typeof schema.identitySessions.$inferInsert> = {
        isValid: false,
        rotatedAt: params.bookkeeping.rotatedAt,
        rotatedToSessionId: params.bookkeeping.rotatedToSessionId,
        updatedAt: new Date(),
      };
      if (params.bookkeeping.rotationAttemptId) set.rotationAttemptId = params.bookkeeping.rotationAttemptId;
      if (params.bookkeeping.receipt) {
        set.rotationReceiptExpiresAt = params.bookkeeping.receipt.expiresAt;
        set.rotationReceiptKeyId = params.bookkeeping.receipt.keyId;
        set.rotationReceiptCiphertext = params.bookkeeping.receipt.ciphertext;
      }

      const claimed: SessionRow[] = await tx
        .update(schema.identitySessions)
        .set(set)
        .where(and(eq(schema.identitySessions.id, params.predecessorId), eq(schema.identitySessions.isValid, true)))
        .returning();
      if (claimed.length === 0) throw new RotationConflictError();

      try {
        const inserted: SessionRow[] = await tx
          .insert(schema.identitySessions)
          .values(PgSessionStore.insertValues(params.newSession))
          .returning();
        return PgSessionStore.toRecord(inserted[0]);
      } catch (error: unknown) {
        if (isUniqueViolation(error)) throw new RotationConflictError();
        throw error;
      }
    });
  }

  /** Plan 1A.13: one joined PK query instead of isSessionValid + findById. */
  async findValidByIdWithUser(id: string): Promise<{ session: SessionRecord; user: UserRecordShape; valid: boolean } | null> {
    if (!isObjectId(id)) return null;
    const rows = await this.q
      .select({ session: schema.identitySessions, user: schema.identityUsers })
      .from(schema.identitySessions)
      .innerJoin(schema.identityUsers, eq(schema.identityUsers.id, schema.identitySessions.userId))
      .where(eq(schema.identitySessions.id, id))
      .limit(1);
    if (rows.length === 0) return null;
    const session = PgSessionStore.toRecord(rows[0].session);
    const valid = session.isValid && session.expiresAt > new Date();
    const user = PgSessionStore.toUserRecordRow(rows[0].user);
    return { session, user, valid };
  }

  private static toUserRecordRow(row: typeof schema.identityUsers.$inferSelect): UserRecordShape {
    return {
      ...row,
      roleIds: [],
      status: row.status as UserRecordShape['status'],
      registrationApproval: row.registrationApproval as UserRecordShape['registrationApproval'],
      colorTheme: row.colorTheme as UserRecordShape['colorTheme'],
    };
  }
}
