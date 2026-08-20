import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import appDataConfig from '@config/app-data.config';
import { AppRuntimeModule } from '@modules/app-runtime/app-runtime.module';
import { ConversationV2Module } from '@modules/conversation-v2/conversation-v2.module';
import {
  ConversationV2Session,
  ConversationV2SessionSchema,
} from '@modules/conversation-v2/schemas/conversation-v2-session.schema';
import { AppDataMcpController } from './controllers/app-data-mcp.controller';
import { AppDataPublicController } from './controllers/app-data-public.controller';
import { AppDataPublicAuthController } from './controllers/app-data-public-auth.controller';
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
import { AppDataLifecycleService } from './services/app-data-lifecycle.service';
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

@Module({
  imports: [
    ConfigModule.forFeature(appDataConfig),
    JwtModule.register({}),
    forwardRef(() => AppRuntimeModule),
    forwardRef(() => ConversationV2Module),
    MongooseModule.forFeature([
      { name: ConversationV2Session.name, schema: ConversationV2SessionSchema },
    ]),
  ],
  controllers: [
    AppDataMcpController,
    AppDataPublicController,
    AppDataPublicAuthController,
    AppDataOwnerController,
    AppDataHealthController,
  ],
  providers: [
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
    AppDataLifecycleService,
  ],
  exports: [
    AppDataCatalogService,
    AppDataDeploymentService,
    AppDataReleaseBindingService,
    AppDataProvisioningService,
    AppDataMcpDispatcherService,
  ],
})
export class AppDataModule {}
