import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './services/auth.service';
import { SessionService } from './services/session.service';
import { RegistrationService } from './services/registration.service';
import { AuthEmailService } from './services/auth-email.service';
import { AuthController } from './controllers/auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { InternalServiceGuard } from './guards/internal-service.guard';
import { AgentCrudActorGuard } from './guards/agent-crud-actor.guard';
import { PgSessionStore } from './persistence/pg-session.store';
import { JWT_ALGORITHM } from './constants/jwt.constants';
import { AuthThrottleService } from './throttle/auth-throttle.service';
import { LoginLockoutService } from './throttle/login-lockout.service';
import { UserModule } from '../user';
import { UsageModule } from '../usage';
import { AuthorizationModule } from '../authorization/authorization.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { HumainAgentModule } from '../humain-agent/humain-agent.module';

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),
        signOptions: {
          algorithm: JWT_ALGORITHM,
          issuer: configService.get<string>('jwt.issuer'),
          audience: configService.get<string>('jwt.audience'),
        },
      }),
      inject: [ConfigService],
    }),
    forwardRef(() => UserModule),
    forwardRef(() => UsageModule),
    forwardRef(() => AuthorizationModule),
    forwardRef(() => WorkspaceModule),
    HumainAgentModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    RegistrationService,
    AuthEmailService,
    JwtStrategy,
    JwtAuthGuard,
    InternalServiceGuard,
    AgentCrudActorGuard,
    AuthThrottleService,
    LoginLockoutService,
    // Mongo-backed until the 1A cutover; swap useClass to PgSessionStore then.
    PgSessionStore,
  ],
  exports: [AuthService, SessionService, RegistrationService, AuthThrottleService, JwtAuthGuard, JwtStrategy, InternalServiceGuard, AgentCrudActorGuard, JwtModule],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module: configuration lives in the decorator
export class AuthModule {}
