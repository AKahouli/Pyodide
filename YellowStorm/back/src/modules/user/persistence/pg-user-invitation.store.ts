import { Inject } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { newObjectId } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import * as schema from '@modules/postgres/schema';
import {
  USER_INVITATION_STORE,
  type NewUserInvitation,
  type UserInvitationRecord,
  type UserInvitationStore,
} from './user-invitation.store';

/** PostgreSQL identity.user_invitations implementation of UserInvitationStore. */
export class PgUserInvitationStore implements UserInvitationStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async create(init: NewUserInvitation): Promise<UserInvitationRecord> {
    const [row] = await this.q
      .insert(schema.identityUserInvitations)
      .values({ id: newObjectId(), ...init })
      .returning();
    return this.toRecord(row);
  }

  async findByTokenHash(tokenHash: string): Promise<UserInvitationRecord | null> {
    const [row] = await this.q
      .select()
      .from(schema.identityUserInvitations)
      .where(eq(schema.identityUserInvitations.tokenHash, tokenHash))
      .limit(1);
    return row ? this.toRecord(row) : null;
  }

  async consumePendingForEmail(email: string, now: Date): Promise<number> {
    // Re-invite semantics: supersede the still-pending links for this address
    // before a new one is issued, so at most one invitation stays usable.
    const superseded = await this.q
      .update(schema.identityUserInvitations)
      .set({ consumedAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.identityUserInvitations.email, email),
          isNull(schema.identityUserInvitations.consumedAt),
          gt(schema.identityUserInvitations.expiresAt, now),
        ),
      )
      .returning({ id: schema.identityUserInvitations.id });
    return superseded.length;
  }

  async deleteById(id: string): Promise<void> {
    await this.q
      .delete(schema.identityUserInvitations)
      .where(eq(schema.identityUserInvitations.id, id));
  }

  async consumeIfValid(tokenHash: string, now: Date): Promise<boolean> {
    // Conditional UPDATE: the WHERE clause is the entire single-use guarantee —
    // the first statement to match flips consumed_at and the rest match nothing.
    const rows = await this.q
      .update(schema.identityUserInvitations)
      .set({ consumedAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.identityUserInvitations.tokenHash, tokenHash),
          isNull(schema.identityUserInvitations.consumedAt),
          gt(schema.identityUserInvitations.expiresAt, now),
        ),
      )
      .returning({ id: schema.identityUserInvitations.id });
    return rows.length > 0;
  }

  private toRecord(row: typeof schema.identityUserInvitations.$inferSelect): UserInvitationRecord {
    return {
      id: row.id,
      email: row.email,
      tokenHash: row.tokenHash,
      invitedBy: row.invitedBy,
      expiresAt: row.expiresAt,
      consumedAt: row.consumedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
