import { Module } from '@nestjs/common';
import { ModelsModule } from '../models';
import { AiProxyController } from './ai-proxy.controller';
import { AiProxyService } from './ai-proxy.service';

@Module({
  imports: [ModelsModule],
  controllers: [AiProxyController],
  providers: [AiProxyService],
})
export class AiProxyModule {}
