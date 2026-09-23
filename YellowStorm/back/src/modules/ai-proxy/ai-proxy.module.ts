import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ModelsModule } from '../models';
import { UsageModule } from '../usage';
import { AuthModule } from '../auth';
import { UserModule } from '../user/user.module';
import { AppDataModule } from '../app-data/app-data.module';
import { AppRuntimeModule } from '../app-runtime/app-runtime.module';
import { AppBuilderAiModule } from '../app-builder-ai/app-builder-ai.module';
import { ConversationV2Module } from '../conversation-v2/conversation-v2.module';
import { AiProxyController } from './ai-proxy.controller';
import { AiProxyService } from './ai-proxy.service';
import { AiProxyStreamService } from './ai-proxy-stream.service';
import { AiProxyUsageService } from './ai-proxy-usage.service';
import { AiProxyRateLimitGuard } from './guards/ai-proxy-rate-limit.guard';
import { AiProxyPayloadLimitGuard } from './guards/ai-proxy-payload-limit.guard';
import { AppBuilderAiAuthGuard } from './guards/app-builder-ai-auth.guard';
import { AiPreviewTicketService } from './services/ai-preview-ticket.service';
import { AI_PREVIEW_TICKET_STORE } from './persistence/ai-preview-ticket.store';
import { PgAiPreviewTicketStore } from './persistence/pg-ai-preview-ticket.store';

@Module({
  imports: [
    ModelsModule,
    UsageModule,
    JwtModule.register({}),
    forwardRef(() => AuthModule),
    forwardRef(() => UserModule),
    forwardRef(() => AppDataModule),
    forwardRef(() => AppRuntimeModule),
    forwardRef(() => AppBuilderAiModule),
    forwardRef(() => ConversationV2Module),
  ],
  controllers: [AiProxyController],
  providers: [
    { provide: AI_PREVIEW_TICKET_STORE, useClass: PgAiPreviewTicketStore },
    AiProxyService,
    AiProxyStreamService,
    AiProxyUsageService,
    AiProxyRateLimitGuard,
    AiProxyPayloadLimitGuard,
    AppBuilderAiAuthGuard,
    AiPreviewTicketService,
  ],
  exports: [AiPreviewTicketService],
})
export class AiProxyModule {}
