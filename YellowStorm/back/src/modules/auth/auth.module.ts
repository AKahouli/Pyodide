import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { InternalServiceGuard } from './guards/internal-service.guard';
import { AgentCrudActorGuard } from './guards/agent-crud-actor.guard';
import { PgSessionStore } from './persistence/pg-session.store';
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
    JwtStrategy,
    JwtAuthGuard,
    InternalServiceGuard,
    AgentCrudActorGuard,
    // Mongo-backed until the 1A cutover; swap useClass to PgSessionStore then.
    PgSessionStore,
  ],
  exports: [AuthService, JwtAuthGuard, JwtStrategy, InternalServiceGuard, AgentCrudActorGuard, JwtModule],
})
export class AuthModule {}
