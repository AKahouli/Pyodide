import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { ModelsModule } from '../models';
import { UsageModule } from '../usage';
import { AuthModule } from '../auth';
import { UserModule } from '../user/user.module';
import { AppDataModule } from '../app-data/app-data.module';
import { AppRuntimeModule } from '../app-runtime/app-runtime.module';
import { AppBuilderAiModule } from '../app-builder-ai/app-builder-ai.module';
import {
  ConversationV2Session,
  ConversationV2SessionSchema,
} from '../conversation-v2/schemas/conversation-v2-session.schema';
import { AiProxyController } from './ai-proxy.controller';
import { AiProxyService } from './ai-proxy.service';
import { AiProxyStreamService } from './ai-proxy-stream.service';
import { AiProxyUsageService } from './ai-proxy-usage.service';
import { AiProxyRateLimitGuard } from './guards/ai-proxy-rate-limit.guard';
import { AiProxyPayloadLimitGuard } from './guards/ai-proxy-payload-limit.guard';
import { AppBuilderAiAuthGuard } from './guards/app-builder-ai-auth.guard';
import { AiPreviewTicketService } from './services/ai-preview-ticket.service';
import {
  AiPreviewTicket,
  AiPreviewTicketSchema,
} from './schemas/ai-preview-ticket.schema';

@Module({
  imports: [
    ModelsModule,
    UsageModule,
    JwtModule.register({}),
    MongooseModule.forFeature([
      { name: AiPreviewTicket.name, schema: AiPreviewTicketSchema },
      { name: ConversationV2Session.name, schema: ConversationV2SessionSchema },
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => UserModule),
    forwardRef(() => AppDataModule),
    forwardRef(() => AppRuntimeModule),
    forwardRef(() => AppBuilderAiModule),
  ],
  controllers: [AiProxyController],
  providers: [
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
