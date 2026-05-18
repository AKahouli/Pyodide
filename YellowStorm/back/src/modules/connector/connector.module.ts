import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConnectorService } from './connector.service';
import { ConnectorCredentialService } from './connector-credential.service';
import { ConnectorAuthServiceImpl } from './connector-auth.service';
import { ConnectorTransferService } from './connector-transfer.service';
import { M365TransferAdapter } from './adapters/m365-transfer.adapter';
import { Connector, ConnectorSchema } from './schemas/connector.schema';
import { ConnectorCredential, ConnectorCredentialSchema } from './schemas/connector-credential.schema';
import { AdminConnectorAuth, AdminConnectorAuthSchema } from './schemas/admin-connector-auth.schema';
import {
  AdminConnectorOAuthState,
  AdminConnectorOAuthStateSchema,
} from './schemas/admin-connector-oauth-state.schema';
import { AdminConnectorController } from './admin-connector.controller';
import { AdminConnectorAuthCallbackController } from './admin-connector-auth-callback.controller';
import { ConnectorController } from './connector.controller';
import { AuthorizationModule } from '../authorization/authorization.module';
import { ConnectedAppModule } from '../connected-app/connected-app.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { LoggerModule } from '../logger';
import { CryptoService } from '@common/services/crypto.service';
import { ConnectorAdminAuthService } from './services/connector-admin-auth.service';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Connector.name, schema: ConnectorSchema },
      { name: ConnectorCredential.name, schema: ConnectorCredentialSchema },
      { name: AdminConnectorAuth.name, schema: AdminConnectorAuthSchema },
      { name: AdminConnectorOAuthState.name, schema: AdminConnectorOAuthStateSchema },
    ]),
    AuthorizationModule,
    ConnectedAppModule,
    WorkspaceModule,
    LoggerModule,
  ],
  controllers: [AdminConnectorController, AdminConnectorAuthCallbackController, ConnectorController],
  providers: [
    CryptoService,
    ConnectorService,
    ConnectorAdminAuthService,
    ConnectorCredentialService,
    ConnectorAuthServiceImpl,
    ConnectorTransferService,
    M365TransferAdapter,
    {
      provide: 'ConnectorAuthService',
      useExisting: ConnectorAuthServiceImpl,
    },
  ],
  exports: [ConnectorService, ConnectorCredentialService, 'ConnectorAuthService', ConnectorTransferService],
})
export class ConnectorModule {}
