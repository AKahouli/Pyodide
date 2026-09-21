import { Module, forwardRef } from '@nestjs/common';
import { TeamController } from './controllers/team.controller';
import { TeamShareController } from './controllers/team-share.controller';
import { TeamCrudInternalController } from './controllers/team-crud-internal.controller';
import { AdminTeamAutoBuilderController } from './controllers/admin-team-auto-builder.controller';
import { TeamService } from './team.service';
import { TeamShareService } from './services/team-share.service';
import { TeamAutoBuilderConfigService } from './services/team-auto-builder-config.service';
import { TEAM_AUTO_BUILDER_STORE, TEAM_SHARE_STORE, TEAM_STORE } from './persistence/team.store';
import { PgTeamAutoBuilderStore, PgTeamShareStore, PgTeamStore } from './persistence/pg-team.store';
import { TeamPermissionGuard } from './guards/team-permission.guard';
import { AgentModule } from '../agent/agent.module';
import { UserModule } from '../user/user.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AuthModule } from '../auth/auth.module';
import { ChatCompletionModule } from '../chat-completion/chat-completion.module';
import { AgentTypeModule } from '../agent-type/agent-type.module';
import { ToolModule } from '../tool/tool.module';
import { ModelsModule } from '../models/models.module';

@Module({
  imports: [
    forwardRef(() => AgentModule),
    UserModule,
    AuthorizationModule,
    AuthModule,
    ChatCompletionModule,
    AgentTypeModule,
    ToolModule,
    ModelsModule,
  ],
  controllers: [TeamController, TeamShareController, TeamCrudInternalController, AdminTeamAutoBuilderController],
  providers: [
    // Teams cutover (plan 4.3-4.5): PG-backed stores.
    { provide: TEAM_STORE, useClass: PgTeamStore },
    { provide: TEAM_SHARE_STORE, useClass: PgTeamShareStore },
    { provide: TEAM_AUTO_BUILDER_STORE, useClass: PgTeamAutoBuilderStore },TeamService, TeamShareService, TeamAutoBuilderConfigService, TeamPermissionGuard],
  exports: [TeamService, TeamShareService],
})
export class TeamModule {}
