import { Global, Module, forwardRef } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SystemService } from './system.service';
import { UserModule } from '../user/user.module';
import { SystemController } from './system.controller';
import { WorkspaceUploadSettingsService } from './workspace-upload-settings.service';
import { AdminWorkspaceUploadSettingsController } from './controllers/admin-workspace-upload-settings.controller';
import { WorkspaceUploadSettingsController } from './controllers/workspace-upload-settings.controller';
import { MaintenanceGuard } from './guards/maintenance.guard';
import { AuthorizationModule } from '../authorization/authorization.module';
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
import { SemanticExtractionAgentBootstrapService } from './services/semantic-extraction-agent.bootstrap';
import { AppearanceLogoService } from './services/appearance-logo.service';
import { AppearanceLogoController } from './controllers/appearance-logo.controller';
import { NavigationSettingsService } from './navigation-settings.service';
import { SYSTEM_SETTING_STORE } from './persistence/system-setting.store';
import { PgSystemSettingStore } from './persistence/pg-system-setting.store';
import { APPEARANCE_LOGO_STORE } from './persistence/appearance-logo.store';
import { PgAppearanceLogoStore } from './persistence/pg-appearance-logo.store';

@Global() // Make SystemService available globally for the guard
@Module({
  imports: [
    UserModule,
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
    // Settings + appearance cutover (plan 1B.2.1/1B.2.2): catalog.system_settings
    // and catalog.appearance_logos; Mongo data backfilled before the flip.
    { provide: SYSTEM_SETTING_STORE, useClass: PgSystemSettingStore },
    { provide: APPEARANCE_LOGO_STORE, useClass: PgAppearanceLogoStore },
    WorkspaceUploadSettingsService,
    WorkspaceEvidenceSearchSettingsService,
    WorkspaceTransformationSettingsService,
    ConversationSettingsService,
    FeatureVisibilityService,
    NavigationSettingsService,
    PlatformCopilotBootstrapService,
    SemanticExtractionAgentBootstrapService,
    {
      provide: APP_GUARD,
      useClass: MaintenanceGuard,
    },
  ],
  exports: [SystemService, SYSTEM_SETTING_STORE, WorkspaceUploadSettingsService, WorkspaceEvidenceSearchSettingsService, WorkspaceTransformationSettingsService, ConversationSettingsService, FeatureVisibilityService, NavigationSettingsService],
})
export class SystemModule {}
