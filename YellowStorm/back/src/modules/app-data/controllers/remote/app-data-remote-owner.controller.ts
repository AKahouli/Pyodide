import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { ConversationV2OwnerGuard } from '@modules/conversation-v2/guards/conversation-v2-owner.guard';
import { ConversationV2SessionService } from '@modules/conversation-v2/services/conversation-v2-session.service';
import { AppDataClientService } from '../../services/app-data-client.service';
import { AppDataDeploymentService } from '../../services/app-data-deployment.service';
import { AppDataEndUserGrantsService } from '../../services/app-data-end-user-grants.service';
import type { AppDataEnvironment } from '../../constants/app-data.constants';
import type { AppDataEndUserGrants, AppDataEndUserStatus } from '../../constants/app-data.types';
import { assertIdentifier } from '../../utils/app-data-sql.util';
import { parseAppDataEnvironment, parsePositiveInt } from '../../utils/app-data-request.util';
import { assertAppDataEnabled, assertEndUserManagementEnabled } from '../../utils/app-data-feature.util';

/**
 * Remote-mode owner Data tab. Reads the session → workspace mapping locally,
 * then delegates every query to the app-data microservice internal API.
 */
@ApiTags('App Data Owner')
@Controller('conversation-v2/sessions/:id/app-data')
@UseGuards(ConversationV2OwnerGuard)
export class AppDataRemoteOwnerController {
  constructor(
    private readonly config: ConfigService,
    private readonly client: AppDataClientService,
    private readonly sessions: ConversationV2SessionService,
    @Inject(AppDataDeploymentService)
    private readonly deployment: AppDataDeploymentService,
  ) {}

  private assertEnabled(): void {
    assertAppDataEnabled(this.config);
  }

  private assertEndUserManagementEnabled(): void {
    assertEndUserManagementEnabled(this.config);
  }

  private async workspaceId(sessionId: string): Promise<string> {
    const session = await this.sessions.getById(sessionId);
    if (!session?.aiSessionId) {
      throw new ServiceUnavailableException('Session has no AI workspace attached');
    }
    return session.aiSessionId;
  }

  private async requireRemoteAppId(sessionId: string): Promise<{
    appId: string;
    workspaceId: string;
  }> {
    const ws = await this.workspaceId(sessionId);
    const app = await this.client.getAppByWorkspace(ws);
    if (!app) {
      throw new ServiceUnavailableException('App Data is not provisioned for this workspace');
    }
    return { appId: app.id, workspaceId: ws };
  }

  @Get('status')
  @ApiOperation({ summary: 'Owner read-only App Data status (remote)' })
  async status(@Param('id') sessionId: string) {
    this.assertEnabled();
    const ws = await this.workspaceId(sessionId);
    const app = await this.client.getAppByWorkspace(ws);
    if (!app) {
      // Return the same shape as the local catalog.getStatus() so callers
      // can rely on the AppDataStatus type without mode-specific branching.
      return {
        enabled: true,
        appDataId: null,
        workspaceId: ws,
        lifecycleState: null,
        endUserAuthEnabled: false,
        dev: { provisioned: false, schemaName: null, currentVersion: null },
        prod: { provisioned: false, schemaName: null, currentVersion: null },
      };
    }
    const remote = await this.client.getStatus(app.id);
    const envRow = (env: string) =>
      (remote.environments ?? []).find(
        (e) =>
          (e as { env?: string }).env === env ||
          (e as { environment?: string }).environment === env,
      ) as { provisioned_at?: string | null } | undefined;
    // schemaName and currentVersion are null in remote mode because the
    // microservice does not expose them via the status endpoint. The frontend
    // must handle nulls gracefully (the AppDataStatus type marks them optional).
    return {
      enabled: true,
      appDataId: app.id,
      workspaceId: ws,
      lifecycleState: 'active',
      endUserAuthEnabled: true,
      dev: { provisioned: !!envRow('dev')?.provisioned_at, schemaName: null, currentVersion: null },
      prod: { provisioned: !!envRow('prod')?.provisioned_at, schemaName: null, currentVersion: null },
    };
  }

  /**
   * Session-scoped data ticket for the dev preview. The Nodepod relay attaches
   * it as `Authorization: Bearer <ticket>` so App Data operations are attributed
   * to the requesting user — the owner, or a Share-by-Email recipient — without
   * any login inside the generated app.
   */
  @Get('ticket')
  @ApiOperation({ summary: 'Issue a session-scoped App Data data ticket (dev preview)' })
  async ticket(@Param('id') sessionId: string, @Req() req: Request) {
    if (!this.config.get<boolean>('appData.enabled', false)) {
      throw new ServiceUnavailableException('App Data is disabled');
    }
    // ConversationV2OwnerGuard resolved the session and set this. `actorUserId`
    // is the requesting owner or shared recipient; `ownerId` is the session owner
    // who must own the provisioned app row regardless of who asked first.
    const resolved = (req as Request & { conversationV2Session?: unknown })
      .conversationV2Session as
      | { ownerId?: string; actorUserId?: string }
      | undefined;
    if (!resolved?.ownerId || !resolved?.actorUserId) {
      throw new ServiceUnavailableException('Session identity missing on request');
    }
    const ws = await this.workspaceId(sessionId);
    // Idempotent upsert — also lazily attaches the owner to pre-existing apps.
    const ensured = await this.client.ensureApp(ws, undefined, resolved.ownerId);
    const { ticket } = await this.client.issueTicket({
      workspaceId: ws,
      userId: resolved.actorUserId,
      appDataId: ensured.id,
      env: 'dev',
    });
    const runtimeEnv = await this.deployment.getRuntimeEnvForWorkspace(ws, 'dev');
    return {
      ticket,
      appDataId: ensured.id,
      publicUrl: runtimeEnv?.publicUrl ?? null,
    };
  }

  @Get('end-users')
  @ApiOperation({ summary: 'List registered app end-users and their CRUD + AI grants (remote)' })
  async listEndUsers(@Param('id') sessionId: string) {
    this.assertEndUserManagementEnabled();
    const { appId } = await this.requireRemoteAppId(sessionId);
    return { users: await this.client.listEndUsers(appId) };
  }

  @Put('end-users/:userId/grants')
  @ApiOperation({ summary: 'Update CRUD + AI grants for an app end-user (remote)' })
  async updateEndUserGrants(
    @Param('id') sessionId: string,
    @Param('userId') userId: string,
    @Body() body: Partial<AppDataEndUserGrants>,
  ) {
    this.assertEndUserManagementEnabled();
    const { appId } = await this.requireRemoteAppId(sessionId);
    const usersBefore = await this.client.listEndUsers(appId);
    const current = usersBefore.find((u) => u.id === userId)?.grants ?? null;
    const grants: AppDataEndUserGrants = AppDataEndUserGrantsService.mergeGrants(current, body);
    await this.client.replaceWildcardGrants(appId, userId, grants);
    const users = await this.client.listEndUsers(appId);
    return { user: users.find((u) => u.id === userId) ?? null };
  }

  @Patch('end-users/:userId/status')
  @ApiOperation({ summary: 'Enable or disable an app end-user account (remote)' })
  async updateEndUserStatus(
    @Param('id') sessionId: string,
    @Param('userId') userId: string,
    @Body() body: { status?: AppDataEndUserStatus },
  ) {
    this.assertEndUserManagementEnabled();
    const { appId } = await this.requireRemoteAppId(sessionId);
    const status = body?.status === 'disabled' ? 'disabled' : 'active';
    await this.client.updateUserStatus(appId, userId, status);
    const users = await this.client.listEndUsers(appId);
    return { user: users.find((u) => u.id === userId) ?? null };
  }

  @Get(':environment/tables')
  async tables(
    @Param('id') sessionId: string,
    @Param('environment') environment: AppDataEnvironment,
  ) {
    this.assertEnabled();
    const env = parseAppDataEnvironment(environment);
    const { appId } = await this.requireRemoteAppId(sessionId);
    const tables = await this.client.listTables(appId, env);
    return { environment: env, currentVersion: null, tables };
  }

  @Get(':environment/tables/:table/rows')
  async rows(
    @Param('id') sessionId: string,
    @Param('environment') environment: AppDataEnvironment,
    @Param('table') table: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    this.assertEnabled();
    assertIdentifier(table, 'table name');
    const env = parseAppDataEnvironment(environment);
    const { appId } = await this.requireRemoteAppId(sessionId);
    return this.client.listOwnerRows(appId, env, table, {
      page: String(parsePositiveInt(page, 1)),
      pageSize: pageSize ? String(parsePositiveInt(pageSize, 50)) : undefined,
    });
  }

  /**
   * Seed rows into DEV from the owner Data tab. DEV-only: PROD data stays
   * user-generated (binding copies schema only). Rows are attributed to the
   * session owner so the dev preview (owner data ticket) sees them.
   */
  @Post(':environment/seed')
  @ApiOperation({
    summary: 'Seed DEV rows (owner Data tab)',
    description:
      'Idempotently bulk-insert seed rows into DEV tables ({ "tables": { "<table>": [ {row}, ... ] } }). Re-runs with the same explicit row ids are skipped.',
  })
  async seed(
    @Param('id') sessionId: string,
    @Param('environment') environment: AppDataEnvironment,
    @Body() body: { tables?: Record<string, Record<string, unknown>[]> },
    @Req() req: Request,
  ) {
    this.assertEnabled();
    const env = parseAppDataEnvironment(environment);
    if (env !== 'dev') {
      throw new BadRequestException('Seeding is DEV-only');
    }
    const { appId } = await this.requireRemoteAppId(sessionId);
    const tables = Object.entries(body?.tables ?? {}).map(([name, rows]) => ({
      name,
      rows: Array.isArray(rows) ? rows : [],
    }));
    if (tables.length === 0) {
      throw new BadRequestException('Seed payload must include at least one table');
    }
    const ownerUserId = (req as Request & { user?: { id: string } }).user?.id;
    return this.client.seedRows(appId, env, tables, ownerUserId);
  }
}
