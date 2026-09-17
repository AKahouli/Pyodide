import { Module } from '@nestjs/common';
import { ModelsModule } from '../models';
import { AiProxyController } from './ai-proxy.controller';
import { AiProxyService } from './ai-proxy.service';
import { AiProxyStreamService } from './ai-proxy-stream.service';

@Module({
  imports: [ModelsModule],
  controllers: [AiProxyController],
  providers: [AiProxyService, AiProxyStreamService],
})
export class AiProxyModule {}
