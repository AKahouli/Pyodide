import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '@modules/auth/auth.module';
import appRuntimeConfig from '@config/app-runtime.config';
import { AppRuntimeInternalController } from './controllers/app-runtime-internal.controller';
import {
  AppRuntimeBinding,
  AppRuntimeBindingSchema,
} from './schemas/app-runtime-binding.schema';
import {
  AppRuntimeToolCall,
  AppRuntimeToolCallSchema,
} from './schemas/app-runtime-tool-call.schema';
import { RuntimeBindingService } from './services/runtime-binding.service';
import { RuntimeTokenService } from './services/runtime-token.service';

@Module({
  imports: [
    ConfigModule.forFeature(appRuntimeConfig),
    forwardRef(() => AuthModule),
    MongooseModule.forFeature([
      { name: AppRuntimeBinding.name, schema: AppRuntimeBindingSchema },
      { name: AppRuntimeToolCall.name, schema: AppRuntimeToolCallSchema },
    ]),
  ],
  controllers: [AppRuntimeInternalController],
  providers: [RuntimeTokenService, RuntimeBindingService],
  exports: [RuntimeTokenService, RuntimeBindingService],
})
export class AppRuntimeModule {}
