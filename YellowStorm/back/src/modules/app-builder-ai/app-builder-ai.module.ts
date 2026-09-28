import { Module, forwardRef } from '@nestjs/common';
import { PostgresModule } from '../postgres/postgres.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { RateLimiterModule } from '../rate-limiter/rate-limiter.module';
import { AppDataModule } from '../app-data/app-data.module';
import { ConversationV2Module } from '../conversation-v2/conversation-v2.module';
import { UserModule } from '../user/user.module';
import { AppBuilderAiSettingsService } from './services/app-builder-ai-settings.service';
import { AppBuilderAiOfferService } from './services/app-builder-ai-offer.service';
import { AppBuilderAiUsageService } from './services/app-builder-ai-usage.service';
import { AppBuilderAiAdminService } from './services/app-builder-ai-admin.service';
import { AppBuilderAiKillSwitchGuard } from './guards/app-builder-ai-kill-switch.guard';
import { AppBuilderAiUsageLimitGuard } from './guards/app-builder-ai-usage-limit.guard';
import { AdminAppBuilderAiController } from './controllers/admin-app-builder-ai.controller';
import { PgAppBuilderAiOfferStore } from './persistence/pg-app-builder-ai-offer.store';

@Module({
  imports: [
    PostgresModule,
    RateLimiterModule,
    forwardRef(() => AuthorizationModule),
    forwardRef(() => AppDataModule),
    forwardRef(() => ConversationV2Module),
    forwardRef(() => UserModule),
  ],
  controllers: [AdminAppBuilderAiController],
  providers: [
    PgAppBuilderAiOfferStore,
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
