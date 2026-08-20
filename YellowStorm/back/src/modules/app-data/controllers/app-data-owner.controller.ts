import {
  Controller,
  Get,
  Param,
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
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ConversationV2Session,
  ConversationV2SessionDocument,
} from '@modules/conversation-v2/schemas/conversation-v2-session.schema';
import type { AppDataEnvironment } from '../constants/app-data.constants';
import { assertIdentifier } from '../utils/app-data-sql.util';

@ApiTags('App Data Owner')
@Controller('conversation-v2/sessions/:id/app-data')
@UseGuards(ConversationV2OwnerGuard)
export class AppDataOwnerController {
  constructor(
    private readonly config: ConfigService,
    private readonly catalog: AppDataCatalogService,
    private readonly migrations: AppDataMigrationService,
    private readonly query: AppDataQueryService,
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

  private async workspaceId(sessionId: string): Promise<string> {
    const session = await this.sessions.findById(sessionId).lean();
    if (!session?.aiSessionId) {
      throw new ServiceUnavailableException('Session has no AI workspace attached');
    }
    return session.aiSessionId;
  }

  @Get('status')
  @ApiOperation({ summary: 'Owner read-only App Data status' })
  async status(@Param('id') sessionId: string) {
    this.assertEnabled();
    const ws = await this.workspaceId(sessionId);
    return this.catalog.getStatus(ws);
  }

  @Get(':environment/tables')
  async tables(
    @Param('id') sessionId: string,
    @Param('environment') environment: AppDataEnvironment,
  ) {
    this.assertEnabled();
    const ws = await this.workspaceId(sessionId);
    const app = await this.catalog.requireAppByWorkspace(ws);
    const manifest = await this.migrations.getCurrentManifest(app.id, environment);
    return {
      environment,
      currentVersion: (await this.catalog.getEnvironment(app.id, environment))?.currentVersion ?? 0,
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
    const ws = await this.workspaceId(sessionId);
    const app = await this.catalog.requireAppByWorkspace(ws);
    return this.query.listRows({
      appDataId: app.appDataId,
      environment,
      table,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : undefined,
      principal: 'yellowmind_owner',
      ownerUserId: app.ownerUserId,
      skipPolicyCheck: true,
    });
  }
}
