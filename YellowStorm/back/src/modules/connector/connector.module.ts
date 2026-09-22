import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { CONNECTOR_ADMIN_AUTH_STORE, CONNECTOR_ADMIN_OAUTH_STATE_STORE, CONNECTOR_CATEGORY_STORE, CONNECTOR_CREDENTIAL_STORE, CONNECTOR_STORE } from './persistence/connector.store';
import { PgConnectorAdminAuthStore, PgConnectorAdminOauthStateStore, PgConnectorCategoryStore, PgConnectorCredentialStore, PgConnectorStore } from './persistence/pg-connector.store';

import { ConnectorService } from './connector.service';
import { ConnectorCategoryService } from './connector-category.service';
import { ConnectorCredentialService } from './connector-credential.service';
import { ConnectorAuthServiceImpl } from './connector-auth.service';
import { ConnectorTransferService } from './connector-transfer.service';
import { M365TransferAdapter } from './adapters/m365-transfer.adapter';
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
import { CONNECTED_APP_DEFINITION_STORE, USER_APP_CONNECTION_STORE } from '../connected-app/persistence/connected-app.store';
import { PgConnectedAppDefinitionStore, PgUserAppConnectionStore } from '../connected-app/persistence/pg-connected-app.store';

@Module({
  imports: [
    ConfigModule,
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
    // Integrations cutover (plan step 3.4-3.6): PG-backed connector stores.
    { provide: CONNECTOR_STORE, useClass: PgConnectorStore },
    { provide: CONNECTOR_CATEGORY_STORE, useClass: PgConnectorCategoryStore },
    { provide: CONNECTOR_CREDENTIAL_STORE, useClass: PgConnectorCredentialStore },
    { provide: CONNECTOR_ADMIN_AUTH_STORE, useClass: PgConnectorAdminAuthStore },
    { provide: CONNECTOR_ADMIN_OAUTH_STATE_STORE, useClass: PgConnectorAdminOauthStateStore },
    // Catalog-transfer reads/writes connected-app definitions (plan 3.7).
    { provide: CONNECTED_APP_DEFINITION_STORE, useClass: PgConnectedAppDefinitionStore },
    { provide: USER_APP_CONNECTION_STORE, useClass: PgUserAppConnectionStore },
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
