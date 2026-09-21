import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PostgresModule } from '../postgres/postgres.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { RateLimiterModule } from '../rate-limiter/rate-limiter.module';
import { AppDataModule } from '../app-data/app-data.module';
import { SystemSetting, SystemSettingSchema } from '../system/schemas/system-setting.schema';
import { User, UserSchema } from '../user/schemas/user.schema';
import {
  ConversationV2Session,
  ConversationV2SessionSchema,
} from '../conversation-v2/schemas/conversation-v2-session.schema';
import {
  AppBuilderAiOffer,
  AppBuilderAiOfferSchema,
} from './schemas/app-builder-ai-offer.schema';
import { AppBuilderAiSettingsService } from './services/app-builder-ai-settings.service';
import { AppBuilderAiOfferService } from './services/app-builder-ai-offer.service';
import { AppBuilderAiUsageService } from './services/app-builder-ai-usage.service';
import { AppBuilderAiAdminService } from './services/app-builder-ai-admin.service';
import { AppBuilderAiKillSwitchGuard } from './guards/app-builder-ai-kill-switch.guard';
import { AppBuilderAiUsageLimitGuard } from './guards/app-builder-ai-usage-limit.guard';
import { AdminAppBuilderAiController } from './controllers/admin-app-builder-ai.controller';

@Module({
  imports: [
    PostgresModule,
    RateLimiterModule,
    forwardRef(() => AuthorizationModule),
    forwardRef(() => AppDataModule),
    MongooseModule.forFeature([
      { name: SystemSetting.name, schema: SystemSettingSchema },
      { name: AppBuilderAiOffer.name, schema: AppBuilderAiOfferSchema },
      { name: User.name, schema: UserSchema },
      { name: ConversationV2Session.name, schema: ConversationV2SessionSchema },
    ]),
  ],
  controllers: [AdminAppBuilderAiController],
  providers: [
    AppBuilderAiSettingsService,
    AppBuilderAiOfferService,
    AppBuilderAiUsageService,
    AppBuilderAiAdminService,
    AppBuilderAiKillSwitchGuard,
    AppBuilderAiUsageLimitGuard,
  ],
  exports: [
    AppBuilderAiSettingsService,
    AppBuilderAiOfferService,
    AppBuilderAiUsageService,
    AppBuilderAiKillSwitchGuard,
    AppBuilderAiUsageLimitGuard,
  ],
})
export class AppBuilderAiModule {}
