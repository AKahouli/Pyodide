import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CONNECTED_APP_DEFINITION_STORE } from './persistence/connected-app.store';
import { PgConnectedAppDefinitionStore } from './persistence/pg-connected-app.store';
import { CONNECTED_APP_OAUTH_STATE_STORE } from './persistence/connected-app.store';
import { PgConnectedAppOauthStateStore } from './persistence/pg-connected-app.store';
import { USER_APP_CONNECTION_STORE } from './persistence/connected-app.store';
import { PgUserAppConnectionStore } from './persistence/pg-connected-app.store';
import { ConnectedAppDefinitionService } from './services/connected-app-definition.service';
import { ConnectedAppOAuthService } from './services/connected-app-oauth.service';
import { ConnectedAppTokenService } from './services/connected-app-token.service';
import { ConnectedAppUserService } from './services/connected-app-user.service';
import { ConnectedAppController } from './controllers/connected-app.controller';
import { ConnectedAppCallbackController } from './controllers/connected-app-callback.controller';
import { ConnectedAppAdminController } from './controllers/connected-app-admin.controller';
import { CryptoService } from '@common/services/crypto.service';

@Module({
  imports: [ConfigModule],
  controllers: [
    ConnectedAppController,
    ConnectedAppCallbackController,
    ConnectedAppAdminController,
  ],
  providers: [
    CryptoService,
    // Integrations cutover (plan step 3.1-3.3): PG-backed stores.
    { provide: CONNECTED_APP_DEFINITION_STORE, useClass: PgConnectedAppDefinitionStore },
    { provide: USER_APP_CONNECTION_STORE, useClass: PgUserAppConnectionStore },
    { provide: CONNECTED_APP_OAUTH_STATE_STORE, useClass: PgConnectedAppOauthStateStore },
    ConnectedAppDefinitionService,
    ConnectedAppOAuthService,
    ConnectedAppTokenService,
    ConnectedAppUserService,
  ],
  exports: [
    ConnectedAppDefinitionService,
    ConnectedAppOAuthService,
    ConnectedAppTokenService,
    // Consumer modules (connector) share these PG stores (plan 3.7).
    CONNECTED_APP_DEFINITION_STORE,
    USER_APP_CONNECTION_STORE,
    CONNECTED_APP_OAUTH_STATE_STORE,
  ],
})
export class ConnectedAppModule {}
