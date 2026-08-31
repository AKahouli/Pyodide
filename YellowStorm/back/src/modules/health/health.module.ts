import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PublicHealthController } from './public-health.controller';
import { AdminHealthController } from './admin-health.controller';
import { AdminPostgresHealthController } from './admin-postgres-health.controller';
import { PostgresHealthService } from './postgres-health.service';
import { AuthorizationModule } from '../authorization';
import { HealthService } from './health.service';
import { HealthHistoryService } from './health-history.service';
import { HealthHistory, HealthHistorySchema } from './schemas/health-history.schema';
import { UsageModule } from '../usage';
import { ModelsModule } from '../models';
import { ConversationModule } from '../conversation';
import { ConversationV2Module } from '../conversation-v2/conversation-v2.module';
import { SemanticModelModule } from '../semantic-model/semantic-model.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HealthHistory.name, schema: HealthHistorySchema },
    ]),
    UsageModule,  // Import to use UsageService
    forwardRef(() => ModelsModule),  // Import to use ModelsService for health checks
    forwardRef(() => ConversationModule),  // Import to use StreamService for gRPC health checks
    forwardRef(() => ConversationV2Module),  // Import to use ConversationV2GrpcClientService for V2 gRPC health
    SemanticModelModule,
    AuthorizationModule,
  ],
  controllers: [PublicHealthController, AdminHealthController, AdminPostgresHealthController],
  providers: [HealthService, HealthHistoryService, PostgresHealthService],
  exports: [HealthService, HealthHistoryService],
})
export class HealthModule {}
