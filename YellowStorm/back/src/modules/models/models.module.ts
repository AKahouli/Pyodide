import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import litellmConfig from '../../config/litellm.config';
import { ModelsController } from './models.controller';
import { AdminModelsController } from './admin-models.controller';
import { ModelsService } from './models.service';
import { LiteLLMClient } from './litellm.client';
import { LiteLLMConnectionService } from './litellm-connection.service';
import { MODEL_STORE } from './persistence/model.store';
import { PgModelStore } from './persistence/pg-model.store';
import { AuthorizationModule } from '../authorization/authorization.module';

@Module({
  imports: [
    ConfigModule.forFeature(litellmConfig),
    AuthorizationModule,
  ],
  controllers: [ModelsController, AdminModelsController],
  providers: [
    LiteLLMConnectionService,
    LiteLLMClient,
    // Models cutover (plan 1B.3.1): catalog.ai_models; Mongo data backfilled before this flip.
    { provide: MODEL_STORE, useClass: PgModelStore },
    ModelsService,
  ],
  exports: [ModelsService, LiteLLMConnectionService],
})
export class ModelsModule {}
