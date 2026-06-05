import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { ConversationV2Controller } from './conversation-v2.controller';
import { ConversationV2StreamController } from './conversation-v2-stream.controller';
import { ConversationV2GrpcClientService } from './services/conversation-v2.grpc-client.service';
import { ConversationV2SessionService } from './services/conversation-v2-session.service';
import { ConversationV2PointerWriterService } from './services/conversation-v2-pointer-writer.service';
import { ConversationV2ShareService } from './services/conversation-v2-share.service';
import { ConversationV2EventStoreService } from './services/conversation-v2-event-store.service';
import { ConversationV2StreamGatewayService } from './services/conversation-v2-stream-gateway.service';
import { ConversationV2StreamService } from './services/conversation-v2-stream.service';
import { ConversationV2OwnerGuard } from './guards/conversation-v2-owner.guard';
import { SseAuthGuard } from '@modules/conversation/guards/stream-auth.guard';
import { AuthModule } from '@modules/auth/auth.module';
import { WorkspaceModule } from '@modules/workspace/workspace.module';
import { ChatCompletionModule } from '@modules/chat-completion';
import { ModelsModule } from '@modules/models/models.module';
import { ConversationV2NameGeneratorService } from './services/conversation-v2-name-generator.service';
import conversationV2Config from '@config/conversation-v2.config';
import {
  ConversationV2Session,
  ConversationV2SessionSchema,
} from './schemas/conversation-v2-session.schema';
import {
  ConversationV2Event,
  ConversationV2EventSchema,
} from './schemas/conversation-v2-event.schema';

@Module({
  imports: [
    ConfigModule.forFeature(conversationV2Config),
    JwtModule.register({}),
    forwardRef(() => AuthModule),
    forwardRef(() => WorkspaceModule),
    ChatCompletionModule,
    ModelsModule,
    MongooseModule.forFeature([
      { name: ConversationV2Session.name, schema: ConversationV2SessionSchema },
      { name: ConversationV2Event.name, schema: ConversationV2EventSchema },
    ]),
  ],
  controllers: [ConversationV2Controller, ConversationV2StreamController],
  providers: [ConversationV2GrpcClientService, ConversationV2SessionService, SseAuthGuard, ConversationV2PointerWriterService, ConversationV2ShareService, ConversationV2EventStoreService, ConversationV2StreamGatewayService, ConversationV2StreamService, ConversationV2OwnerGuard, ConversationV2NameGeneratorService],
  exports: [ConversationV2GrpcClientService, ConversationV2SessionService, ConversationV2PointerWriterService, ConversationV2ShareService, ConversationV2EventStoreService, ConversationV2OwnerGuard],
})
export class ConversationV2Module {}
