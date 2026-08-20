import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@modules/postgres/schema';
import {
  appDataEndUserGrants,
  appDataEndUsers,
  type AppDataEndUserRow,
} from '@modules/postgres/schema/app-data.schema';
import type {
  AppDataEndUserStatus,
  AppDataEndUserSummary,
} from '../constants/app-data.types';
import {
  AppDataErrorCode,
  AppDataException,
} from '../constants/app-data.errors';
import { AppDataEndUserGrantsService } from './app-data-end-user-grants.service';

@Injectable()
export class AppDataEndUserService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly grants: AppDataEndUserGrantsService,
  ) {}

  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  async findByEmail(appId: string, email: string): Promise<AppDataEndUserRow | null> {
    const normalized = this.normalizeEmail(email);
    const rows = await this.db
      .select()
      .from(appDataEndUsers)
      .where(and(eq(appDataEndUsers.appId, appId), eq(appDataEndUsers.email, normalized)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findById(appId: string, userId: string): Promise<AppDataEndUserRow | null> {
    const rows = await this.db
      .select()
      .from(appDataEndUsers)
      .where(and(eq(appDataEndUsers.appId, appId), eq(appDataEndUsers.id, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async requireById(appId: string, userId: string): Promise<AppDataEndUserRow> {
    const user = await this.findById(appId, userId);
    if (!user) {
      throw new AppDataException(AppDataErrorCode.ROW_NOT_FOUND, 'End user not found');
    }
    return user;
  }

  async listForApp(appId: string): Promise<AppDataEndUserSummary[]> {
    const users = await this.db
      .select()
      .from(appDataEndUsers)
      .where(eq(appDataEndUsers.appId, appId));

    const summaries: AppDataEndUserSummary[] = [];
    for (const user of users) {
      const grantRows = await this.db
        .select()
        .from(appDataEndUserGrants)
        .where(and(eq(appDataEndUserGrants.appId, appId), eq(appDataEndUserGrants.userId, user.id)))
        .limit(1);
      const grantRow = grantRows[0];
      summaries.push({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        status: user.status as AppDataEndUserStatus,
        grants: grantRow
          ? this.grants.toGrantsObject(grantRow)
          : this.grants.denyAllTemplate(),
        createdAt: user.createdAt.toISOString(),
      });
    }
    return summaries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async updateStatus(
    appId: string,
    userId: string,
    status: AppDataEndUserStatus,
  ): Promise<AppDataEndUserSummary> {
    const rows = await this.db
      .update(appDataEndUsers)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(appDataEndUsers.appId, appId), eq(appDataEndUsers.id, userId)))
      .returning();
    if (!rows[0]) {
      throw new AppDataException(AppDataErrorCode.ROW_NOT_FOUND, 'End user not found');
    }
    const list = await this.listForApp(appId);
    const summary = list.find((u) => u.id === userId);
    if (!summary) {
      throw new AppDataException(AppDataErrorCode.ROW_NOT_FOUND, 'End user not found');
    }
    return summary;
  }
}
