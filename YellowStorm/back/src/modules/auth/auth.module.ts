import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { InternalServiceGuard } from './guards/internal-service.guard';
import { Session, SessionSchema } from './schemas/session.schema';
import { UserModule } from '../user';
import { UsageModule } from '../usage';
import { AuthorizationModule } from '../authorization/authorization.module';

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
    MongooseModule.forFeature([
      { name: Session.name, schema: SessionSchema },
    ]),
    UserModule,
    forwardRef(() => UsageModule),
    forwardRef(() => AuthorizationModule),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard, InternalServiceGuard],
  exports: [AuthService, JwtAuthGuard, JwtStrategy, InternalServiceGuard],
})
export class AuthModule {}
