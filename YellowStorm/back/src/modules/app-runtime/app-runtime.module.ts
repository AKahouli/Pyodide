import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '@modules/auth/auth.module';
import appRuntimeConfig from '@config/app-runtime.config';
import { AppRuntimeInternalController } from './controllers/app-runtime-internal.controller';
import { AppRuntimeGateway } from './gateways/app-runtime.gateway';
import {
  AppRuntimeBinding,
  AppRuntimeBindingSchema,
} from './schemas/app-runtime-binding.schema';
import {
  AppRuntimeTicket,
  AppRuntimeTicketSchema,
} from './schemas/app-runtime-ticket.schema';
import {
  AppRuntimeToolCall,
  AppRuntimeToolCallSchema,
} from './schemas/app-runtime-tool-call.schema';
import {
  AppSourceRevision,
  AppSourceRevisionSchema,
} from './schemas/app-source-revision.schema';
import { RuntimeBindingService } from './services/runtime-binding.service';
import { RuntimeConnectionRegistry } from './services/runtime-connection.registry';
import { RuntimeRevisionService } from './services/runtime-revision.service';
import { RuntimeTicketService } from './services/runtime-ticket.service';
import { RuntimeTokenService } from './services/runtime-token.service';
import { RuntimeToolDispatcherService } from './services/runtime-tool-dispatcher.service';

@Module({
  imports: [
    ConfigModule.forFeature(appRuntimeConfig),
    forwardRef(() => AuthModule),
    MongooseModule.forFeature([
      { name: AppRuntimeBinding.name, schema: AppRuntimeBindingSchema },
      { name: AppRuntimeTicket.name, schema: AppRuntimeTicketSchema },
      { name: AppRuntimeToolCall.name, schema: AppRuntimeToolCallSchema },
      { name: AppSourceRevision.name, schema: AppSourceRevisionSchema },
    ]),
  ],
  controllers: [AppRuntimeInternalController],
  providers: [
    RuntimeTokenService,
    RuntimeRevisionService,
    RuntimeBindingService,
    RuntimeTicketService,
    RuntimeConnectionRegistry,
    RuntimeToolDispatcherService,
    AppRuntimeGateway,
  ],
  exports: [
    RuntimeTokenService,
    RuntimeBindingService,
    RuntimeTicketService,
    RuntimeRevisionService,
  ],
})
export class AppRuntimeModule {}
