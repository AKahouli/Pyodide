import { Module } from '@nestjs/common';
import { ModelsModule } from '../models';
import { UsageModule } from '../usage';
import { AiProxyController } from './ai-proxy.controller';
import { AiProxyService } from './ai-proxy.service';
import { AiProxyStreamService } from './ai-proxy-stream.service';
import { AiProxyUsageService } from './ai-proxy-usage.service';
import { AiProxyRateLimitGuard } from './guards/ai-proxy-rate-limit.guard';
import { AiProxyPayloadLimitGuard } from './guards/ai-proxy-payload-limit.guard';

@Module({
  imports: [ModelsModule, UsageModule],
  controllers: [AiProxyController],
  providers: [
    AiProxyService,
    AiProxyStreamService,
    AiProxyUsageService,
    AiProxyRateLimitGuard,
    AiProxyPayloadLimitGuard,
  ],
})
export class AiProxyModule {}
