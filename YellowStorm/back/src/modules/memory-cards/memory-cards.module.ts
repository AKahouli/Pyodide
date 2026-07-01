import { Module } from '@nestjs/common';
import { LoggerModule } from '../logger';
import { AgentModule } from '../agent/agent.module';
import { MemoryCardsService } from './memory-cards.service';
import { MemoryCardsController } from './memory-cards.controller';

@Module({
  imports: [LoggerModule, AgentModule],
  controllers: [MemoryCardsController],
  providers: [MemoryCardsService],
  exports: [MemoryCardsService],
})
export class MemoryCardsModule {}
