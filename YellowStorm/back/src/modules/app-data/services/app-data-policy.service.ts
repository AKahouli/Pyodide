import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@modules/postgres/schema';
import { appDataPolicies } from '@modules/postgres/schema/app-data.schema';
import {
  APP_DATA_PRINCIPALS,
  DEFAULT_DEV_TABLE_POLICY,
  type AppDataEnvironment,
  type AppDataPrincipal,
} from '../constants/app-data.constants';
import {
  AppDataErrorCode,
  AppDataException,
  AppDataPolicyDeniedException,
} from '../constants/app-data.errors';
import type {
  AppDataPolicyDocument,
  AppDataPolicyOperation,
  AppDataTablePolicy,
} from '../constants/app-data.types';
import { assertIdentifier } from '../utils/app-data-sql.util';
import { AppDataCatalogService } from './app-data-catalog.service';
import { AppDataAuditService } from './app-data-audit.service';

@Injectable()
export class AppDataPolicyService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly catalog: AppDataCatalogService,
    private readonly audit: AppDataAuditService,
  ) {}

  async getPolicies(workspaceId: string, environment: AppDataEnvironment): Promise<AppDataPolicyDocument> {
    const app = await this.catalog.requireAppByWorkspace(workspaceId);
    const rows = await this.db
      .select()
      .from(appDataPolicies)
      .where(and(eq(appDataPolicies.appId, app.id), eq(appDataPolicies.environment, environment)));
    const doc: AppDataPolicyDocument = {};
    for (const row of rows) {
      doc[row.tableName] = row.policyJson as AppDataTablePolicy;
    }
    return doc;
  }

  async applyPolicies(params: {
    workspaceId: string;
    environment: AppDataEnvironment;
    policies: AppDataPolicyDocument;
    actorPrincipal?: string;
  }): Promise<AppDataPolicyDocument> {
    const app = await this.catalog.requireAppByWorkspace(params.workspaceId);
    for (const [tableName, policy] of Object.entries(params.policies)) {
      assertIdentifier(tableName, 'table name');
      this.validatePolicy(policy);
      await this.db
        .insert(appDataPolicies)
        .values({
          appId: app.id,
          environment: params.environment,
          tableName,
          policyJson: policy,
        })
        .onConflictDoUpdate({
          target: [appDataPolicies.appId, appDataPolicies.environment, appDataPolicies.tableName],
          set: { policyJson: policy, updatedAt: new Date() },
        });
    }
    await this.audit.record({
      appId: app.id,
      eventType: 'policy_apply',
      actorPrincipal: params.actorPrincipal ?? 'mcp',
      metadata: { environment: params.environment, tables: Object.keys(params.policies) },
    });
    return this.getPolicies(params.workspaceId, params.environment);
  }

  /**
   * Seed DEV policies for newly created tables so preview (anonymous) and MCP (yellowmind_owner) work.
   */
  async ensureDevDefaultPolicies(params: {
    workspaceId: string;
    tableNames: string[];
    actorPrincipal?: string;
  }): Promise<void> {
    if (params.tableNames.length === 0) return;
    const policies: AppDataPolicyDocument = {};
    for (const tableName of params.tableNames) {
      policies[tableName] = {
        select: [...DEFAULT_DEV_TABLE_POLICY.select],
        insert: [...DEFAULT_DEV_TABLE_POLICY.insert],
        update: [...DEFAULT_DEV_TABLE_POLICY.update],
        delete: [...DEFAULT_DEV_TABLE_POLICY.delete],
      };
    }
    await this.applyPolicies({
      workspaceId: params.workspaceId,
      environment: 'dev',
      policies,
      actorPrincipal: params.actorPrincipal ?? 'schema_apply',
    });
  }

  assertAllowed(
    tablePolicy: AppDataTablePolicy | undefined,
    operation: AppDataPolicyOperation,
    principal: AppDataPrincipal,
    table: string,
  ): void {
    const allowed = tablePolicy?.[operation] ?? [];
    if (!allowed.includes(principal)) {
      throw new AppDataPolicyDeniedException(table, operation, principal);
    }
  }

  /**
   * Copy all policies from one environment to another for the same app.
   * Existing target policies are overwritten (upsert).
   */
  async replicatePolicies(
    appId: string,
    fromEnvironment: AppDataEnvironment,
    toEnvironment: AppDataEnvironment,
  ): Promise<void> {
    const rows = await this.db
      .select()
      .from(appDataPolicies)
      .where(
        and(
          eq(appDataPolicies.appId, appId),
          eq(appDataPolicies.environment, fromEnvironment),
        ),
      );

    for (const row of rows) {
      const policyJson =
        toEnvironment === 'prod'
          ? this.stripAnonymousPrincipal(row.policyJson as AppDataTablePolicy)
          : row.policyJson;
      await this.db
        .insert(appDataPolicies)
        .values({
          appId,
          environment: toEnvironment,
          tableName: row.tableName,
          policyJson,
        })
        .onConflictDoUpdate({
          target: [appDataPolicies.appId, appDataPolicies.environment, appDataPolicies.tableName],
          set: { policyJson, updatedAt: new Date() },
        });
    }

    await this.audit.record({
      appId,
      eventType: 'policy_replicate',
      actorPrincipal: 'deploy',
      metadata: {
        from: fromEnvironment,
        to: toEnvironment,
        tables: rows.map((r) => r.tableName),
      },
    });
  }

  resolvePrincipal(params: {
    anonymous: boolean;
    ownerUserId: string | null;
    requestUserId: string | null;
  }): AppDataPrincipal {
    if (params.anonymous) return 'anonymous';
    if (params.requestUserId && params.ownerUserId && params.requestUserId === params.ownerUserId) {
      return 'yellowmind_owner';
    }
    if (params.requestUserId) return 'public';
    return 'anonymous';
  }

  private stripAnonymousPrincipal(policy: AppDataTablePolicy): AppDataTablePolicy {
    const strip = (list?: AppDataPrincipal[]): AppDataPrincipal[] =>
      (list ?? []).filter((principal) => principal !== 'anonymous');
    return {
      select: strip(policy.select),
      insert: strip(policy.insert),
      update: strip(policy.update),
      delete: strip(policy.delete),
    };
  }

  private validatePolicy(policy: AppDataTablePolicy): void {
    for (const op of ['select', 'insert', 'update', 'delete'] as const) {
      const list = policy[op];
      if (!list) continue;
      if (!Array.isArray(list)) {
        throw new AppDataException(AppDataErrorCode.INVALID_MANIFEST, `Policy ${op} must be an array`);
      }
      for (const p of list) {
        if (!APP_DATA_PRINCIPALS.includes(p as AppDataPrincipal)) {
          throw new AppDataException(AppDataErrorCode.INVALID_MANIFEST, `Invalid principal: ${p}`);
        }
      }
    }
  }
}
