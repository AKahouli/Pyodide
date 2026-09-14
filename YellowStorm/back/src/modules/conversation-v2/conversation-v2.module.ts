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
import { ConversationV2DeployService } from './services/conversation-v2-deploy.service';
import { ConversationV2AppShareService } from './services/conversation-v2-app-share.service';
import { ConversationV2OwnerGuard } from './guards/conversation-v2-owner.guard';
import { ConversationV2SessionAccessGuard } from './guards/conversation-v2-session-access.guard';
import { ConversationV2SessionAccessService } from './services/conversation-v2-session-access.service';
import { SseAuthGuard } from '@modules/conversation/guards/stream-auth.guard';
import { AuthModule } from '@modules/auth/auth.module';
import { AppRuntimeModule } from '@modules/app-runtime/app-runtime.module';
import { AppDataModule } from '@modules/app-data/app-data.module';
import { WorkspaceModule } from '@modules/workspace/workspace.module';
import { ChatCompletionModule } from '@modules/chat-completion';
import { ModelsModule } from '@modules/models/models.module';
import { SkillModule } from '@modules/skill/skill.module';
import { ConnectorModule } from '@modules/connector/connector.module';
import { EmailModule } from '@modules/email/email.module';
import { UserModule } from '@modules/user/user.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
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
import {
  ConversationV2AppShare,
  ConversationV2AppShareSchema,
} from './schemas/conversation-v2-app-share.schema';

@Module({
  imports: [
    ConfigModule.forFeature(conversationV2Config),
    JwtModule.register({}),
    forwardRef(() => AuthModule),
    forwardRef(() => WorkspaceModule),
    forwardRef(() => AppRuntimeModule),
    forwardRef(() => AppDataModule),
    UserModule,
    NotificationsModule,
    ChatCompletionModule,
    ModelsModule,
    SkillModule,
    ConnectorModule,
    EmailModule,
    MongooseModule.forFeature([
      { name: ConversationV2Session.name, schema: ConversationV2SessionSchema },
      { name: ConversationV2Event.name, schema: ConversationV2EventSchema },
      { name: ConversationV2AppShare.name, schema: ConversationV2AppShareSchema },
    ]),
  ],
  controllers: [ConversationV2Controller, ConversationV2StreamController],
  providers: [ConversationV2GrpcClientService, ConversationV2SessionService, SseAuthGuard, ConversationV2PointerWriterService, ConversationV2ShareService, ConversationV2EventStoreService, ConversationV2StreamGatewayService, ConversationV2StreamService, ConversationV2OwnerGuard, ConversationV2SessionAccessGuard, ConversationV2SessionAccessService, ConversationV2NameGeneratorService, ConversationV2DeployService, ConversationV2AppShareService],
  exports: [ConversationV2GrpcClientService, ConversationV2SessionService, ConversationV2PointerWriterService, ConversationV2ShareService, ConversationV2EventStoreService, ConversationV2OwnerGuard, ConversationV2SessionAccessGuard, ConversationV2SessionAccessService, ConversationV2StreamService, ConversationV2AppShareService],
})
export class ConversationV2Module {}
