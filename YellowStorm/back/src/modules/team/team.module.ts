import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TeamController } from './controllers/team.controller';
import { TeamShareController } from './controllers/team-share.controller';
import { AdminTeamAutoBuilderController } from './controllers/admin-team-auto-builder.controller';
import { TeamService } from './team.service';
import { TeamShareService } from './services/team-share.service';
import { TeamAutoBuilderConfigService } from './services/team-auto-builder-config.service';
import { TeamPermissionGuard } from './guards/team-permission.guard';
import { Team, TeamSchema } from './schemas/team.schema';
import { SharedTeam, SharedTeamSchema } from './schemas/shared-team.schema';
import {
  TeamAutoBuilderConfig,
  TeamAutoBuilderConfigSchema,
} from './schemas/team-auto-builder-config.schema';
import { AgentModule } from '../agent/agent.module';
import { UserModule } from '../user/user.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { ChatCompletionModule } from '../chat-completion/chat-completion.module';
import { AgentTypeModule } from '../agent-type/agent-type.module';
import { ToolModule } from '../tool/tool.module';
import { ModelsModule } from '../models/models.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Team.name, schema: TeamSchema },
      { name: SharedTeam.name, schema: SharedTeamSchema },
      { name: TeamAutoBuilderConfig.name, schema: TeamAutoBuilderConfigSchema },
    ]),
    forwardRef(() => AgentModule),
    UserModule,
    AuthorizationModule,
    ChatCompletionModule,
    AgentTypeModule,
    ToolModule,
    ModelsModule,
  ],
  controllers: [TeamController, TeamShareController, AdminTeamAutoBuilderController],
  providers: [TeamService, TeamShareService, TeamAutoBuilderConfigService, TeamPermissionGuard],
  exports: [TeamService, TeamShareService],
})
export class TeamModule {}
