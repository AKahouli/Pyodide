import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import loggingConfig from '@config/logging.config';
import { LoggerService } from './logger.service';
import { LogBufferService } from './log-buffer.service';
import { Log, LogSchema } from './schemas/log.schema';

@Global()
@Module({
  imports: [
    ConfigModule.forFeature(loggingConfig),
    // Separate MongoDB connection for logging (isolated from main app DB)
    MongooseModule.forRootAsync({
      connectionName: 'logging',
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const persistenceEnabled = configService.get<boolean>('logging.persistenceEnabled', true);

        if (!persistenceEnabled) {
          // Return a dummy config that won't connect
          // The LogBufferService handles the case when logModel is undefined
          return {
            uri: 'mongodb://localhost:27017/noop',
            lazyConnection: true,
          };
        }

        const uri = configService.get<string>('logging.uri');

        console.log('[LoggerModule] Connecting to logging MongoDB...');

        return {
          uri,
          maxPoolSize: configService.get<number>('logging.maxPoolSize', 3),
          minPoolSize: configService.get<number>('logging.minPoolSize', 1),
          serverSelectionTimeoutMS: 5000,
          socketTimeoutMS: 30000,
          connectTimeoutMS: 10000,
          retryWrites: true,
          retryReads: true,
          // Connection events
          connectionFactory: (connection) => {
            connection.on('connected', () => {
              console.log('[LoggerModule] Logging MongoDB connected successfully');
            });
            connection.on('error', (error: Error) => {
              console.error('[LoggerModule] Logging MongoDB connection error:', error.message);
            });
            connection.on('disconnected', () => {
              console.warn('[LoggerModule] Logging MongoDB disconnected');
            });
            return connection;
          },
        };
      },
      inject: [ConfigService],
    }),
    // Register Log schema with logging connection
    MongooseModule.forFeature([{ name: Log.name, schema: LogSchema }], 'logging'),
  ],
  providers: [LoggerService, LogBufferService],
  exports: [LoggerService, LogBufferService],
})
export class LoggerModule {}
