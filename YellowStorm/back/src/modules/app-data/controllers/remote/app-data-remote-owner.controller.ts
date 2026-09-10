import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConversationV2OwnerGuard } from '@modules/conversation-v2/guards/conversation-v2-owner.guard';
import {
  ConversationV2Session,
  ConversationV2SessionDocument,
} from '@modules/conversation-v2/schemas/conversation-v2-session.schema';
import { AppDataClientService } from '../../services/app-data-client.service';
import type { AppDataEnvironment } from '../../constants/app-data.constants';
import type { AppDataEndUserGrants, AppDataEndUserStatus } from '../../constants/app-data.types';
import { assertIdentifier } from '../../utils/app-data-sql.util';
import { parseAppDataEnvironment, parsePositiveInt } from '../../utils/app-data-request.util';

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
    @InjectModel(ConversationV2Session.name)
    private readonly sessions: Model<ConversationV2SessionDocument>,
  ) {}

  private assertEnabled(): void {
    if (
      !this.config.get<boolean>('appData.enabled', false) ||
      !this.config.get<boolean>('appData.dataTabEnabled', false)
    ) {
      throw new ServiceUnavailableException('App Data owner API is disabled');
    }
  }

  private assertEndUserManagementEnabled(): void {
    if (
      !this.config.get<boolean>('appData.enabled', false) ||
      !this.config.get<boolean>('appData.endUserAuthEnabled', true)
    ) {
      throw new ServiceUnavailableException('App Data end-user management is disabled');
    }
  }

  private async workspaceId(sessionId: string): Promise<string> {
    const session = await this.sessions.findById(sessionId).lean();
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

  @Get('end-users')
  @ApiOperation({ summary: 'List registered app end-users and their CRUD grants (remote)' })
  async listEndUsers(@Param('id') sessionId: string) {
    this.assertEndUserManagementEnabled();
    const { appId } = await this.requireRemoteAppId(sessionId);
    return { users: await this.client.listEndUsers(appId) };
  }

  @Put('end-users/:userId/grants')
  @ApiOperation({ summary: 'Update CRUD grants for an app end-user (remote)' })
  async updateEndUserGrants(
    @Param('id') sessionId: string,
    @Param('userId') userId: string,
    @Body() body: Partial<AppDataEndUserGrants>,
  ) {
    this.assertEndUserManagementEnabled();
    const { appId } = await this.requireRemoteAppId(sessionId);
    const grants: AppDataEndUserGrants = {
      create: body?.create === true,
      read: body?.read === true,
      update: body?.update === true,
      delete: body?.delete === true,
    };
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
}
