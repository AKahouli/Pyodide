import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthProviderService } from './services/auth-provider.service';
import { OAuthFlowService } from './services/oauth-flow.service';
import { ProviderLinkService } from './services/provider-link.service';
import { AuthProviderHealthService } from './services/auth-provider-health.service';
import { OAuthController } from './controllers/oauth.controller';
import { AuthProviderAdminController } from './controllers/auth-provider-admin.controller';
import { CryptoService } from '@common/services/crypto.service';
import { AuthModule } from '@modules/auth/auth.module';
import { UserModule } from '@modules/user';
import { UsageModule } from '@modules/usage';
import { AuthorizationModule } from '@modules/authorization/authorization.module';
import { WorkspaceModule } from '@modules/workspace/workspace.module';
import {
  PgAuthProviderStore,
  PgOAuthStateStore,
  PgProviderLinkTokenStore,
  PgUserProviderLinkStore,
} from './persistence/pg-auth-provider.stores';

@Module({
  imports: [
    ConfigModule,
    forwardRef(() => AuthModule),
    UserModule,
    forwardRef(() => UsageModule),
    forwardRef(() => AuthorizationModule),
    forwardRef(() => WorkspaceModule),
  ],
  controllers: [OAuthController, AuthProviderAdminController],
  providers: [
    CryptoService,
    AuthProviderService,
    OAuthFlowService,
    ProviderLinkService,
    AuthProviderHealthService,
    // Mongo-backed until the 1A cutover; swap useClass to the Pg* stores then.
    PgAuthProviderStore,
    PgOAuthStateStore,
    PgProviderLinkTokenStore,
    PgUserProviderLinkStore,
  ],
  exports: [AuthProviderService, ProviderLinkService, AuthProviderHealthService],
})
export class AuthProviderModule {}
