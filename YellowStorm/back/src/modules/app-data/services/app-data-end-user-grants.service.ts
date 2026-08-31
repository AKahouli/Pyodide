import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@modules/postgres/schema';
import {
  appDataEndUserGrants,
  type AppDataEndUserGrantRow,
} from '@modules/postgres/schema/app-data.schema';
import type {
  AppDataEndUserGrants,
  AppDataGrantOperation,
} from '../constants/app-data.types';
import {
  AppDataErrorCode,
  AppDataException,
  AppDataGrantDeniedException,
} from '../constants/app-data.errors';
import type { AppDataPolicyOperation } from '../constants/app-data.types';

const DENY_ALL_GRANTS: AppDataEndUserGrants = {
  create: false,
  read: false,
  update: false,
  delete: false,
};

@Injectable()
export class AppDataEndUserGrantsService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  static policyOperationToGrant(op: AppDataPolicyOperation): AppDataGrantOperation {
    switch (op) {
      case 'insert':
        return 'create';
      case 'select':
        return 'read';
      case 'update':
        return 'update';
      case 'delete':
        return 'delete';
      default:
        throw new AppDataException(AppDataErrorCode.INVALID_MANIFEST, `Unknown operation: ${op}`);
    }
  }

  toGrantsObject(row: AppDataEndUserGrantRow): AppDataEndUserGrants {
    return {
      create: row.canCreate,
      read: row.canRead,
      update: row.canUpdate,
      delete: row.canDelete,
    };
  }

  async seedDenyAll(appId: string, userId: string): Promise<void> {
    await this.db.insert(appDataEndUserGrants).values({
      appId,
      userId,
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
    });
  }

  async getGrants(appId: string, userId: string): Promise<AppDataEndUserGrants | null> {
    const rows = await this.db
      .select()
      .from(appDataEndUserGrants)
      .where(and(eq(appDataEndUserGrants.appId, appId), eq(appDataEndUserGrants.userId, userId)))
      .limit(1);
    const row = rows[0];
    return row ? this.toGrantsObject(row) : null;
  }

  async assertAllowed(
    appId: string,
    userId: string,
    operation: AppDataPolicyOperation,
  ): Promise<void> {
    const grantOp = AppDataEndUserGrantsService.policyOperationToGrant(operation);
    const grants = await this.getGrants(appId, userId);
    if (!grants || !grants[grantOp]) {
      throw new AppDataGrantDeniedException(grantOp);
    }
  }

  async updateGrants(
    appId: string,
    userId: string,
    grants: AppDataEndUserGrants,
  ): Promise<AppDataEndUserGrants> {
    const rows = await this.db
      .update(appDataEndUserGrants)
      .set({
        canCreate: grants.create,
        canRead: grants.read,
        canUpdate: grants.update,
        canDelete: grants.delete,
        updatedAt: new Date(),
      })
      .where(and(eq(appDataEndUserGrants.appId, appId), eq(appDataEndUserGrants.userId, userId)))
      .returning();
    if (!rows[0]) {
      throw new AppDataException(AppDataErrorCode.ROW_NOT_FOUND, 'End user grants not found');
    }
    return this.toGrantsObject(rows[0]);
  }

  denyAllTemplate(): AppDataEndUserGrants {
    return { ...DENY_ALL_GRANTS };
  }
}
