import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConnectorService } from './connector.service';
import { ConnectorCategoryService } from './connector-category.service';
import { ConnectorCredentialService } from './connector-credential.service';
import { ConnectorAuthServiceImpl } from './connector-auth.service';
import { ConnectorTransferService } from './connector-transfer.service';
import { M365TransferAdapter } from './adapters/m365-transfer.adapter';
import { Connector, ConnectorSchema } from './schemas/connector.schema';
import { ConnectorCategory, ConnectorCategorySchema } from './schemas/connector-category.schema';
import { ConnectorCredential, ConnectorCredentialSchema } from './schemas/connector-credential.schema';
import { AdminConnectorAuth, AdminConnectorAuthSchema } from './schemas/admin-connector-auth.schema';
import {
  AdminConnectorOAuthState,
  AdminConnectorOAuthStateSchema,
} from './schemas/admin-connector-oauth-state.schema';
import { AdminConnectorController } from './admin-connector.controller';
import { AdminConnectorCategoryController } from './admin-connector-category.controller';
import { AdminConnectorAuthCallbackController } from './admin-connector-auth-callback.controller';
import { UnifiedOAuthCallbackController } from './controllers/unified-oauth-callback.controller';
import { ConnectorController } from './connector.controller';
import { ConnectorInternalController } from './controllers/connector-internal.controller';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard';
import { ConnectorUserService } from './connector-user.service';
import { AuthorizationModule } from '../authorization/authorization.module';
import { ConnectedAppModule } from '../connected-app/connected-app.module';
import {
  ConnectedAppOAuthState,
  ConnectedAppOAuthStateSchema,
} from '../connected-app/schemas/connected-app-oauth-state.schema';
import { WorkspaceModule } from '../workspace/workspace.module';
import { UserModule } from '../user/user.module';
import { LoggerModule } from '../logger';
import { CryptoService } from '@common/services/crypto.service';
import { ConnectorAdminAuthService } from './services/connector-admin-auth.service';
import { ConnectorPlaybookBindingSyncService } from './services/connector-playbook-binding-sync.service';
import { ConnectorMcpRuntimeService } from './services/connector-mcp-runtime.service';
import { AgentMcpConnectorBootstrapService } from './services/agent-mcp-connector-bootstrap.service';
import { CatalogTransferService } from './services/catalog-transfer.service';
import { AdminCatalogTransferController } from './admin-catalog-transfer.controller';
import { SKILL_STORE } from '../skill/persistence/skill.store';
import { PgSkillStore } from '../skill/persistence/pg-skill.store';
import { SKILL_CATEGORY_STORE } from '../skill/persistence/skill.store';
import { PgSkillCategoryStore } from '../skill/persistence/pg-skill.store';
import {
  ConnectedAppDefinition,
  ConnectedAppDefinitionSchema,
} from '../connected-app/schemas/connected-app-definition.schema';
import {
  UserAppConnection,
  UserAppConnectionSchema,
} from '../connected-app/schemas/user-app-connection.schema';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Connector.name, schema: ConnectorSchema },
      { name: ConnectorCategory.name, schema: ConnectorCategorySchema },
      { name: ConnectorCredential.name, schema: ConnectorCredentialSchema },
      { name: AdminConnectorAuth.name, schema: AdminConnectorAuthSchema },
      { name: AdminConnectorOAuthState.name, schema: AdminConnectorOAuthStateSchema },
      { name: ConnectedAppOAuthState.name, schema: ConnectedAppOAuthStateSchema },
      { name: ConnectedAppDefinition.name, schema: ConnectedAppDefinitionSchema },
      { name: UserAppConnection.name, schema: UserAppConnectionSchema },
    ]),
    AuthorizationModule,
    ConnectedAppModule,
    WorkspaceModule,
    UserModule,
    LoggerModule,
  ],
  controllers: [
    AdminConnectorController,
    AdminConnectorCategoryController,
    AdminConnectorAuthCallbackController,
    UnifiedOAuthCallbackController,
    ConnectorController,
    ConnectorInternalController,
    AdminCatalogTransferController,
  ],
  providers: [
    CryptoService,
    ConnectorService,
    AgentMcpConnectorBootstrapService,
    ConnectorCategoryService,
    ConnectorAdminAuthService,
    ConnectorCredentialService,
    ConnectorAuthServiceImpl,
    ConnectorTransferService,
    ConnectorPlaybookBindingSyncService,
    ConnectorMcpRuntimeService,
    CatalogTransferService,
    M365TransferAdapter,
    ConnectorUserService,
    InternalServiceGuard,
    {
      provide: 'ConnectorAuthService',
      useExisting: ConnectorAuthServiceImpl,
    },
      // Catalog-transfer reads/writes PG-backed skills (plan 1B.4.5).
    { provide: SKILL_STORE, useClass: PgSkillStore },
    { provide: SKILL_CATEGORY_STORE, useClass: PgSkillCategoryStore },
  ],
  exports: [ConnectorService, ConnectorCredentialService, 'ConnectorAuthService', ConnectorTransferService, ConnectorMcpRuntimeService],
})
export class ConnectorModule {}
