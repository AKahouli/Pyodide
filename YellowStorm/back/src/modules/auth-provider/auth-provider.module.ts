import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthProvider, AuthProviderSchema } from './schemas/auth-provider.schema';
import { UserProviderLink, UserProviderLinkSchema } from './schemas/user-provider-link.schema';
import { OAuthState, OAuthStateSchema } from './schemas/oauth-state.schema';
import { ProviderLinkToken, ProviderLinkTokenSchema } from './schemas/provider-link-token.schema';
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

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: AuthProvider.name, schema: AuthProviderSchema },
      { name: UserProviderLink.name, schema: UserProviderLinkSchema },
      { name: OAuthState.name, schema: OAuthStateSchema },
      { name: ProviderLinkToken.name, schema: ProviderLinkTokenSchema },
    ]),
    forwardRef(() => AuthModule),
    UserModule,
    forwardRef(() => UsageModule),
    forwardRef(() => AuthorizationModule),
  ],
  controllers: [OAuthController, AuthProviderAdminController],
  providers: [
    CryptoService,
    AuthProviderService,
    OAuthFlowService,
    ProviderLinkService,
    AuthProviderHealthService,
  ],
  exports: [AuthProviderService, ProviderLinkService, AuthProviderHealthService],
})
export class AuthProviderModule {}
