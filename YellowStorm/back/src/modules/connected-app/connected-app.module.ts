import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ConnectedAppDefinition,
  ConnectedAppDefinitionSchema,
} from './schemas/connected-app-definition.schema';
import {
  ConnectedAppOAuthState,
  ConnectedAppOAuthStateSchema,
} from './schemas/connected-app-oauth-state.schema';
import {
  UserAppConnection,
  UserAppConnectionSchema,
} from './schemas/user-app-connection.schema';
import { ConnectedAppDefinitionService } from './services/connected-app-definition.service';
import { ConnectedAppOAuthService } from './services/connected-app-oauth.service';
import { ConnectedAppTokenService } from './services/connected-app-token.service';
import { ConnectedAppUserService } from './services/connected-app-user.service';
import { ConnectedAppController } from './controllers/connected-app.controller';
import { ConnectedAppCallbackController } from './controllers/connected-app-callback.controller';
import { ConnectedAppAdminController } from './controllers/connected-app-admin.controller';
import { CryptoService } from '@common/services/crypto.service';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: ConnectedAppDefinition.name, schema: ConnectedAppDefinitionSchema },
      { name: ConnectedAppOAuthState.name, schema: ConnectedAppOAuthStateSchema },
      { name: UserAppConnection.name, schema: UserAppConnectionSchema },
    ]),
  ],
  controllers: [
    ConnectedAppController,
    ConnectedAppCallbackController,
    ConnectedAppAdminController,
  ],
  providers: [
    CryptoService,
    ConnectedAppDefinitionService,
    ConnectedAppOAuthService,
    ConnectedAppTokenService,
    ConnectedAppUserService,
  ],
  exports: [ConnectedAppDefinitionService, ConnectedAppOAuthService, ConnectedAppTokenService],
})
export class ConnectedAppModule {}
