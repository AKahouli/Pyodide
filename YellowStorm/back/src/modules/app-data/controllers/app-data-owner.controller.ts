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
import { ConversationV2OwnerGuard } from '@modules/conversation-v2/guards/conversation-v2-owner.guard';
import { AppDataCatalogService } from '../services/app-data-catalog.service';
import { AppDataMigrationService } from '../services/app-data-migration.service';
import { AppDataQueryService } from '../services/app-data-query.service';
import { AppDataEndUserService } from '../services/app-data-end-user.service';
import { AppDataEndUserGrantsService } from '../services/app-data-end-user-grants.service';
import { AppDataAuditService } from '../services/app-data-audit.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ConversationV2Session,
  ConversationV2SessionDocument,
} from '@modules/conversation-v2/schemas/conversation-v2-session.schema';
import type { AppDataEnvironment } from '../constants/app-data.constants';
import type { AppDataEndUserGrants, AppDataEndUserStatus } from '../constants/app-data.types';
import { assertIdentifier } from '../utils/app-data-sql.util';
import { parseAppDataEnvironment, parsePositiveInt } from '../utils/app-data-request.util';

@ApiTags('App Data Owner')
@Controller('conversation-v2/sessions/:id/app-data')
@UseGuards(ConversationV2OwnerGuard)
export class AppDataOwnerController {
  constructor(
    private readonly config: ConfigService,
    private readonly catalog: AppDataCatalogService,
    private readonly migrations: AppDataMigrationService,
    private readonly query: AppDataQueryService,
    private readonly endUsers: AppDataEndUserService,
    private readonly grants: AppDataEndUserGrantsService,
    private readonly audit: AppDataAuditService,
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

  private async requireApp(sessionId: string) {
    const ws = await this.workspaceId(sessionId);
    return this.catalog.requireAppByWorkspace(ws);
  }

  @Get('status')
  @ApiOperation({ summary: 'Owner read-only App Data status' })
  async status(@Param('id') sessionId: string) {
    this.assertEnabled();
    const ws = await this.workspaceId(sessionId);
    return this.catalog.getStatus(ws);
  }

  @Get('end-users')
  @ApiOperation({ summary: 'List registered app end-users and their CRUD grants' })
  async listEndUsers(@Param('id') sessionId: string) {
    this.assertEndUserManagementEnabled();
    const app = await this.requireApp(sessionId);
    return { users: await this.endUsers.listForApp(app.id) };
  }

  @Put('end-users/:userId/grants')
  @ApiOperation({ summary: 'Update CRUD grants for an app end-user' })
  async updateEndUserGrants(
    @Param('id') sessionId: string,
    @Param('userId') userId: string,
    @Body() body: Partial<AppDataEndUserGrants>,
  ) {
    this.assertEndUserManagementEnabled();
    const app = await this.requireApp(sessionId);
    await this.endUsers.requireById(app.id, userId);
    const grants: AppDataEndUserGrants = {
      create: body.create === true,
      read: body.read === true,
      update: body.update === true,
      delete: body.delete === true,
    };
    const updated = await this.grants.updateGrants(app.id, userId, grants);
    await this.audit.record({
      appId: app.id,
      eventType: 'end_user_grant_update',
      actorPrincipal: 'yellowmind_owner',
      metadata: { userId, grants: updated },
    });
    const users = await this.endUsers.listForApp(app.id);
    const user = users.find((u) => u.id === userId);
    return { user };
  }

  @Patch('end-users/:userId/status')
  @ApiOperation({ summary: 'Enable or disable an app end-user account' })
  async updateEndUserStatus(
    @Param('id') sessionId: string,
    @Param('userId') userId: string,
    @Body() body: { status?: AppDataEndUserStatus },
  ) {
    this.assertEndUserManagementEnabled();
    const app = await this.requireApp(sessionId);
    const status = body.status === 'disabled' ? 'disabled' : 'active';
    const user = await this.endUsers.updateStatus(app.id, userId, status);
    await this.audit.record({
      appId: app.id,
      eventType: 'end_user_status_update',
      actorPrincipal: 'yellowmind_owner',
      metadata: { userId, status },
    });
    return { user };
  }

  @Get(':environment/tables')
  async tables(
    @Param('id') sessionId: string,
    @Param('environment') environment: AppDataEnvironment,
  ) {
    this.assertEnabled();
    const env = parseAppDataEnvironment(environment);
    const ws = await this.workspaceId(sessionId);
    const app = await this.catalog.requireAppByWorkspace(ws);
    const manifest = await this.migrations.getCurrentManifest(app.id, env);
    return {
      environment: env,
      currentVersion: (await this.catalog.getEnvironment(app.id, env))?.currentVersion ?? 0,
      tables: Object.keys(manifest.tables ?? {}),
    };
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
    const ws = await this.workspaceId(sessionId);
    const app = await this.catalog.requireAppByWorkspace(ws);
    return this.query.listRows({
      appDataId: app.appDataId,
      environment: env,
      table,
      page: parsePositiveInt(page, 1),
      pageSize: pageSize ? parsePositiveInt(pageSize, 50) : undefined,
      principal: 'yellowmind_owner',
      ownerUserId: app.ownerUserId,
      skipPolicyCheck: true,
    });
  }
}
