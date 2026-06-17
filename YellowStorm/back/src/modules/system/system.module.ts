import { Global, Module, forwardRef } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SystemService } from './system.service';
import { SystemController } from './system.controller';
import { WorkspaceUploadSettingsService } from './workspace-upload-settings.service';
import { AdminWorkspaceUploadSettingsController } from './controllers/admin-workspace-upload-settings.controller';
import { WorkspaceUploadSettingsController } from './controllers/workspace-upload-settings.controller';
import { MaintenanceGuard } from './guards/maintenance.guard';
import { SystemSetting, SystemSettingSchema } from './schemas/system-setting.schema';
import { AuthorizationModule } from '../authorization/authorization.module';
import { User, UserSchema } from '../user/schemas/user.schema';

@Global() // Make SystemService available globally for the guard
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SystemSetting.name, schema: SystemSettingSchema },
      { name: User.name, schema: UserSchema },
    ]),
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
    forwardRef(() => AuthorizationModule),
  ],
  controllers: [
    SystemController,
    AdminWorkspaceUploadSettingsController,
    WorkspaceUploadSettingsController,
  ],
  providers: [
    SystemService,
    WorkspaceUploadSettingsService,
    {
      provide: APP_GUARD,
      useClass: MaintenanceGuard,
    },
  ],
  exports: [SystemService, WorkspaceUploadSettingsService],
})
export class SystemModule {}
