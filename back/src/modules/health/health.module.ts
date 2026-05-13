import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { HealthHistoryService } from './health-history.service';
import { HealthHistory, HealthHistorySchema } from './schemas/health-history.schema';
import { UsageModule } from '../usage';
import { ModelsModule } from '../models';
import { ConversationModule } from '../conversation';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HealthHistory.name, schema: HealthHistorySchema },
    ]),
    UsageModule,  // Import to use UsageService
    forwardRef(() => ModelsModule),  // Import to use ModelsService for health checks
    forwardRef(() => ConversationModule),  // Import to use StreamService for gRPC health checks
  ],
  controllers: [HealthController],
  providers: [HealthService, HealthHistoryService],
  exports: [HealthService, HealthHistoryService],
})
export class HealthModule {}
