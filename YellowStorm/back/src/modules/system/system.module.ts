import { Global, Module, forwardRef } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SystemService } from './system.service';
import { SystemController } from './system.controller';
import { WorkspaceUploadSettingsService } from './workspace-upload-settings.service';
import { AdminWorkspaceUploadSettingsController } from './controllers/admin-workspace-upload-settings.controller';
import { WorkspaceUploadSettingsController } from './controllers/workspace-upload-settings.controller';
import { MaintenanceGuard } from './guards/maintenance.guard';
import { SystemSetting, SystemSettingSchema } from './schemas/system-setting.schema';
import { AppearanceLogo, AppearanceLogoSchema } from './schemas/appearance-logo.schema';
import { AuthorizationModule } from '../authorization/authorization.module';
import { User, UserSchema } from '../user/schemas/user.schema';
import { ConnectorModule } from '../connector/connector.module';
import { WorkspaceEvidenceSearchSettingsService } from './workspace-evidence-search-settings.service';
import { AdminWorkspaceEvidenceSearchSettingsController } from './controllers/admin-workspace-evidence-search-settings.controller';
import { AgentRepositoryModule } from '../agent/repositories/agent-repository.module';
import { AgentModule } from '../agent/agent.module';
import { AgentTypeModule } from '../agent-type/agent-type.module';
import { WorkspaceTransformationSettingsService } from './workspace-transformation-settings.service';
import { AdminWorkspaceTransformationSettingsController } from './controllers/admin-workspace-transformation-settings.controller';
import { ConversationSettingsService } from './conversation-settings.service';
import { AdminConversationSettingsController } from './controllers/admin-conversation-settings.controller';
import { FeatureVisibilityService } from './feature-visibility.service';
import { PlatformCopilotBootstrapService } from './services/platform-copilot-bootstrap.service';
import { AppearanceLogoService } from './services/appearance-logo.service';
import { AppearanceLogoController } from './controllers/appearance-logo.controller';

@Global() // Make SystemService available globally for the guard
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SystemSetting.name, schema: SystemSettingSchema },
      { name: AppearanceLogo.name, schema: AppearanceLogoSchema },
      { name: User.name, schema: UserSchema },
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),
        signOptions: {
          issuer: configService.get<string>('jwt.issuer'),
          audience: configService.get<string>('jwt.audience'),
        },
      }),
      inject: [ConfigService],
    }),
    forwardRef(() => AuthorizationModule),
    ConnectorModule,
    AgentRepositoryModule,
    AgentModule,
    AgentTypeModule,
  ],
  controllers: [
    SystemController,
    AppearanceLogoController,
    AdminWorkspaceUploadSettingsController,
    WorkspaceUploadSettingsController,
    AdminWorkspaceEvidenceSearchSettingsController,
    AdminWorkspaceTransformationSettingsController,
    AdminConversationSettingsController,
  ],
  providers: [
    SystemService,
    AppearanceLogoService,
    WorkspaceUploadSettingsService,
    WorkspaceEvidenceSearchSettingsService,
    WorkspaceTransformationSettingsService,
    ConversationSettingsService,
    FeatureVisibilityService,
    PlatformCopilotBootstrapService,
    {
      provide: APP_GUARD,
      useClass: MaintenanceGuard,
    },
  ],
  exports: [SystemService, WorkspaceUploadSettingsService, WorkspaceEvidenceSearchSettingsService, WorkspaceTransformationSettingsService, ConversationSettingsService, FeatureVisibilityService],
})
export class SystemModule {}
