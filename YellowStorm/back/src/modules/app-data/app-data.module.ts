import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import appDataConfig from '@config/app-data.config';
import { AppRuntimeModule } from '@modules/app-runtime/app-runtime.module';
import { ConversationV2Module } from '@modules/conversation-v2/conversation-v2.module';
import { AppDataMcpController } from './controllers/app-data-mcp.controller';
import { AppDataOwnerController } from './controllers/app-data-owner.controller';
import { AppDataHealthController } from './controllers/app-data-health.controller';
import { AppDataAdvisoryLockService } from './services/app-data-advisory-lock.service';
import { AppDataAuditService } from './services/app-data-audit.service';
import { AppDataCatalogService } from './services/app-data-catalog.service';
import { AppDataDeploymentService } from './services/app-data-deployment.service';
import { AppDataEndUserAuthService } from './services/app-data-end-user-auth.service';
import { AppDataEndUserGrantsService } from './services/app-data-end-user-grants.service';
import { AppDataEndUserService } from './services/app-data-end-user.service';
import { AppDataPublicAccessService } from './services/app-data-public-access.service';
import { AppDataIdentifierService } from './services/app-data-identifier.service';
import { AppDataMigrationService } from './services/app-data-migration.service';
import { AppDataMcpAuthService } from './services/app-data-mcp-auth.service';
import { AppDataMcpDispatcherService } from './services/app-data-mcp-dispatcher.service';
import { AppDataPolicyService } from './services/app-data-policy.service';
import { AppDataProvisioningService } from './services/app-data-provisioning.service';
import { AppDataQueryService } from './services/app-data-query.service';
import { AppDataReleaseBindingService } from './services/app-data-release-binding.service';
import { AppDataRowService } from './services/app-data-row.service';
import { AppDataSchemaDiffService } from './services/app-data-schema-diff.service';
import { AppDataSchemaService } from './services/app-data-schema.service';
import { AppDataClientService } from './services/app-data-client.service';
import { RemoteAppDataDeploymentService } from './services/remote-app-data-deployment.service';
import { RemoteAppDataReleaseBindingService } from './services/remote-app-data-release-binding.service';
import { RemoteAppDataMcpDispatcherService } from './services/remote-app-data-mcp-dispatcher.service';
import { AppDataRemoteOwnerController } from './controllers/remote/app-data-remote-owner.controller';
import { AppDataRemoteHealthController } from './controllers/remote/app-data-remote-health.controller';

/**
 * When APP_DATA_REMOTE=true the module delegates to the standalone app-data
 * microservice: provisioning, release binding and the MCP row tools are
 * HTTP-proxied, and the local tenant-schema services are not registered.
 * Consumers keep injecting the same class tokens (AppDataDeploymentService,
 * AppDataReleaseBindingService, AppDataMcpDispatcherService) — remote
 * implementations are bound to them.
 *
 * Generated apps NEVER talk to this backend for App Data: the public CRUD /
 * auth / invite controllers were removed. Their `VITE_YM_APP_DATA_URL` points
 * straight at the app-data microservice in every mode (local microservice for
 * dev/preview at APP_DATA_REMOTE_PUBLIC_BASE_URL, deployed microservice for
 * PROD at APP_DATA_REMOTE_PUBLIC_BASE_URL_PROD). Only the agent-facing MCP,
 * the owner Data tab and health remain exposed here.
 */
const APP_DATA_USE_REMOTE = appDataConfig().remote;

const LOCAL_CONTROLLERS = [
  AppDataMcpController,
  AppDataOwnerController,
  AppDataHealthController,
];

const REMOTE_CONTROLLERS = [
  AppDataMcpController,
  AppDataRemoteOwnerController,
  AppDataRemoteHealthController,
];

const LOCAL_PROVIDERS = [
  AppDataIdentifierService,
  AppDataCatalogService,
  AppDataAuditService,
  AppDataAdvisoryLockService,
  AppDataProvisioningService,
  AppDataSchemaDiffService,
  AppDataMigrationService,
  AppDataSchemaService,
  AppDataPolicyService,
  AppDataQueryService,
  AppDataRowService,
  AppDataEndUserGrantsService,
  AppDataEndUserService,
  AppDataEndUserAuthService,
  AppDataPublicAccessService,
  AppDataMcpAuthService,
  AppDataMcpDispatcherService,
  AppDataReleaseBindingService,
  AppDataDeploymentService,
];

const REMOTE_PROVIDERS = [
  AppDataClientService,
  AppDataMcpAuthService,
  { provide: AppDataMcpDispatcherService, useClass: RemoteAppDataMcpDispatcherService },
  { provide: AppDataReleaseBindingService, useClass: RemoteAppDataReleaseBindingService },
  { provide: AppDataDeploymentService, useClass: RemoteAppDataDeploymentService },
];

@Module({
  imports: [
    ConfigModule.forFeature(appDataConfig),
    JwtModule.register({}),
    forwardRef(() => AppRuntimeModule),
    forwardRef(() => ConversationV2Module),
  ],
  controllers: APP_DATA_USE_REMOTE ? REMOTE_CONTROLLERS : LOCAL_CONTROLLERS,
  providers: APP_DATA_USE_REMOTE ? REMOTE_PROVIDERS : LOCAL_PROVIDERS,
  exports: APP_DATA_USE_REMOTE
    ? [AppDataDeploymentService, AppDataReleaseBindingService, AppDataMcpDispatcherService, AppDataClientService]
    : [
        AppDataCatalogService,
        AppDataDeploymentService,
        AppDataReleaseBindingService,
        AppDataProvisioningService,
        AppDataMcpDispatcherService,
        AppDataEndUserAuthService,
        AppDataEndUserGrantsService,
      ],
})
export class AppDataModule {}
