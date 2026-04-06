import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

// Schemas
import { Playbook, PlaybookSchema } from './schemas/playbook.schema';
import {
  PlaybookExecution,
  PlaybookExecutionSchema,
} from './schemas/playbook-execution.schema';
import {
  PlaybookDesignMessage,
  PlaybookDesignMessageSchema,
} from './schemas/playbook-design-message.schema';
import {
  PlaybookValidatedReplay,
  PlaybookValidatedReplaySchema,
} from './schemas/playbook-validated-replay.schema';
import {
  PlaybookOutputFormatTemplate,
  PlaybookOutputFormatTemplateSchema,
} from './schemas/playbook-output-format-template.schema';
import {
  PlaybookPromptTemplate,
  PlaybookPromptTemplateSchema,
} from './schemas/playbook-prompt-template.schema';

// Controllers — stream controller must be before playbook controller to avoid :id route conflict
import { PlaybookStreamController } from './controllers/playbook-stream.controller';
import { PlaybookController } from './controllers/playbook.controller';
import { PlaybookExecutionController } from './controllers/playbook-execution.controller';
import { AdminPlaybookPromptsController } from './controllers/admin-playbook-prompts.controller';

// Services
import { PlaybookService } from './services/playbook.service';
import { PlaybookExecutionService } from './services/playbook-execution.service';
import { PlaybookGrpcService } from './services/playbook-grpc.service';
import { PlaybookContextService } from './services/playbook-context.service';
import { PlaybookDesignService } from './services/playbook-design.service';
import { PlaybookReplayService } from './services/playbook-replay.service';
import { PlaybookOutputFormatService } from './services/playbook-output-format.service';
import { PlaybookPromptService } from './services/playbook-prompt.service';
import { PlaybookEvaluationService } from './services/playbook-evaluation.service';
import { PlaybookSemanticEnrichmentService } from './services/playbook-semantic-enrichment.service';
import { PlaybookStreamGatewayService } from './services/playbook-stream-gateway.service';
import { PlaybookScheduleRunnerService } from './services/playbook-schedule-runner.service';

// Guards
import { PlaybookOwnerGuard } from './guards/playbook-owner.guard';
import { PlaybookStreamAuthGuard } from './guards/playbook-stream-auth.guard';

// External modules
import { AuthModule } from '../auth/auth.module';
import { LoggerModule } from '../logger';
import { AgentModule } from '../agent/agent.module';
import { ModelsModule } from '../models/models.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { UsageModule } from '../usage/usage.module';
import { UserModule } from '../user/user.module';
import { NotificationsModule } from '../notifications/notifications.module';
import playbookConfig from './config/playbook.config';

@Module({
  imports: [
    ConfigModule.forFeature(playbookConfig),
    MongooseModule.forFeature([
      { name: Playbook.name, schema: PlaybookSchema },
      { name: PlaybookExecution.name, schema: PlaybookExecutionSchema },
        { name: PlaybookDesignMessage.name, schema: PlaybookDesignMessageSchema },
        { name: PlaybookValidatedReplay.name, schema: PlaybookValidatedReplaySchema },
        { name: PlaybookOutputFormatTemplate.name, schema: PlaybookOutputFormatTemplateSchema },
        { name: PlaybookPromptTemplate.name, schema: PlaybookPromptTemplateSchema },
      ]),
    JwtModule.register({}),
    forwardRef(() => AuthModule),
    LoggerModule,
    AgentModule,
    ModelsModule,
    forwardRef(() => WorkspaceModule),
    UsageModule,
    UserModule,
    NotificationsModule,
  ],
  controllers: [
    PlaybookStreamController, // Must be before PlaybookController to avoid route conflict with :id param
    PlaybookController,
    PlaybookExecutionController,
    AdminPlaybookPromptsController,
  ],
  providers: [
    PlaybookService,
    PlaybookExecutionService,
    PlaybookGrpcService,
    PlaybookContextService,
    PlaybookDesignService,
    PlaybookReplayService,
    PlaybookOutputFormatService,
    PlaybookPromptService,
    PlaybookEvaluationService,
    PlaybookSemanticEnrichmentService,
    PlaybookStreamGatewayService,
    PlaybookScheduleRunnerService,
    PlaybookOwnerGuard,
    PlaybookStreamAuthGuard,
  ],
  exports: [
    PlaybookService,
    PlaybookExecutionService,
    PlaybookGrpcService,
    PlaybookReplayService,
    PlaybookOutputFormatService,
    PlaybookPromptService,
    PlaybookEvaluationService,
    PlaybookSemanticEnrichmentService,
    PlaybookStreamGatewayService,
  ],
})
export class PlaybookModule {}
