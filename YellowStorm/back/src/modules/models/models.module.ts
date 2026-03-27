import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import litellmConfig from '../../config/litellm.config';
import { ModelsController } from './models.controller';
import { AdminModelsController } from './admin-models.controller';
import { ModelsService } from './models.service';
import { LiteLLMClient } from './litellm.client';
import { LiteLLMConnectionService } from './litellm-connection.service';
import { AiModel, AiModelSchema } from './schemas/model.schema';
import { AuthorizationModule } from '../authorization/authorization.module';

@Module({
  imports: [
    ConfigModule.forFeature(litellmConfig),
    MongooseModule.forFeature([{ name: AiModel.name, schema: AiModelSchema }]),
    AuthorizationModule,
  ],
  controllers: [ModelsController, AdminModelsController],
  providers: [LiteLLMConnectionService, LiteLLMClient, ModelsService],
  exports: [ModelsService, LiteLLMConnectionService],
})
export class ModelsModule {}
