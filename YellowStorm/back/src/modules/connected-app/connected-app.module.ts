import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PgConnectedAppDefinitionStore, PgConnectedAppOauthStateStore, PgUserAppConnectionStore } from './persistence/pg-connected-app.store';
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
    PgConnectedAppDefinitionStore,
    PgUserAppConnectionStore,
    PgConnectedAppOauthStateStore,
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
    PgConnectedAppDefinitionStore,
    PgUserAppConnectionStore,
    PgConnectedAppOauthStateStore,
  ],
})
export class ConnectedAppModule {}
