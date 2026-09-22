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
  useAi: false,
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

  /** Normalize grant payloads. Missing keys default to deny (full replace). */
  static coerceGrants(body: Partial<AppDataEndUserGrants> | null | undefined): AppDataEndUserGrants {
    return {
      create: body?.create === true,
      read: body?.read === true,
      update: body?.update === true,
      delete: body?.delete === true,
      useAi: body?.useAi === true,
    };
  }

  /**
   * Merge a partial grant update onto the current grants.
   * Omitted keys keep their previous value (avoids wiping useAi on CRUD-only PUTs).
   */
  static mergeGrants(
    current: AppDataEndUserGrants | null | undefined,
    body: Partial<AppDataEndUserGrants> | null | undefined,
  ): AppDataEndUserGrants {
    const base = current ?? DENY_ALL_GRANTS;
    return {
      create: body?.create !== undefined ? body.create === true : base.create === true,
      read: body?.read !== undefined ? body.read === true : base.read === true,
      update: body?.update !== undefined ? body.update === true : base.update === true,
      delete: body?.delete !== undefined ? body.delete === true : base.delete === true,
      useAi: body?.useAi !== undefined ? body.useAi === true : base.useAi === true,
    };
  }

  toGrantsObject(row: AppDataEndUserGrantRow): AppDataEndUserGrants {
    return {
      create: row.canCreate,
      read: row.canRead,
      update: row.canUpdate,
      delete: row.canDelete,
      useAi: row.canUseAi === true,
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
      canUseAi: false,
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

  async assertUseAi(appId: string, userId: string): Promise<void> {
    const grants = await this.getGrants(appId, userId);
    if (!grants?.useAi) {
      throw new AppDataGrantDeniedException('useAi');
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
        canUseAi: grants.useAi,
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
