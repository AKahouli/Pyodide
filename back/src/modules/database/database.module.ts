import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import databaseConfig from '../../config/database.config';
import { DatabaseConnectionService } from './database-connection.service';
import { LoggerService } from '../logger';

@Global()
@Module({
  imports: [
    ConfigModule.forFeature(databaseConfig),
    // MongooseModule.forRootAsync connects during module initialization
    // This ensures DB is ready before any OnApplicationBootstrap hooks run
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const uri = configService.get<string>('database.uri')!;
        const isProduction = configService.get<string>('app.nodeEnv') === 'production';

        // Log connection attempt (can't inject LoggerService in factory, use console)
        console.log(`[DatabaseModule] Connecting to MongoDB...`);

        return {
          uri,
          maxPoolSize: configService.get<number>('database.maxPoolSize'),
          minPoolSize: configService.get<number>('database.minPoolSize'),
          serverSelectionTimeoutMS: configService.get<number>('database.serverSelectionTimeoutMs'),
          socketTimeoutMS: configService.get<number>('database.socketTimeoutMs'),
          connectTimeoutMS: configService.get<number>('database.connectTimeoutMs'),
          retryWrites: configService.get<boolean>('database.retryWrites'),
          retryReads: configService.get<boolean>('database.retryReads'),
          maxIdleTimeMS: configService.get<number>('database.maxIdleTimeMs'),
          heartbeatFrequencyMS: configService.get<number>('database.heartbeatFrequencyMs'),
          autoIndex: !isProduction,
          autoCreate: !isProduction,
          // Connection events
          connectionFactory: (connection) => {
            connection.on('connected', () => {
              console.log(`[DatabaseModule] MongoDB connected successfully`);
            });
            connection.on('error', (error: Error) => {
              console.error(`[DatabaseModule] MongoDB connection error:`, error.message);
            });
            connection.on('disconnected', () => {
              console.warn(`[DatabaseModule] MongoDB disconnected`);
            });
            return connection;
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [DatabaseConnectionService],
  exports: [DatabaseConnectionService, MongooseModule],
})
export class DatabaseModule {}
