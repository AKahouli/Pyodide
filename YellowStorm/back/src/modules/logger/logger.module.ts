import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import loggingConfig from '@config/logging.config';
import { LoggerService } from './logger.service';
import { OpsLogsService } from './ops-logs.service';

// OpsLogsService reads historic ops.logs through the global Drizzle connection, which it
// resolves lazily (the pool depends on LoggerService, so it cannot be injected here).
@Global()
@Module({
  imports: [ConfigModule.forFeature(loggingConfig)],
  providers: [LoggerService, OpsLogsService],
  exports: [LoggerService, OpsLogsService],
})
export class LoggerModule {}
