import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import loggingConfig from '@config/logging.config';
import { LoggerService } from './logger.service';
import { LogBufferService } from './log-buffer.service';

// P6 cutover: logs are written to ops.logs through the global Drizzle connection, which LogBufferService
// resolves lazily (the pool depends on LoggerService, so it cannot be injected here).
@Global()
@Module({
  imports: [ConfigModule.forFeature(loggingConfig)],
  providers: [LoggerService, LogBufferService],
  exports: [LoggerService, LogBufferService],
})
export class LoggerModule {}
