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
import {
  PlaybookNodeTemplate,
  PlaybookNodeTemplateSchema,
} from './schemas/playbook-node-template.schema';
import {
  PlaybookMailEventLedger,
  PlaybookMailEventLedgerSchema,
} from './schemas/playbook-mail-event-ledger.schema';
import {
  PlaybookEvaluationBaseline,
  PlaybookEvaluationBaselineSchema,
} from './schemas/playbook-evaluation-baseline.schema';
import {
  PlaybookEvaluationExecution,
  PlaybookEvaluationExecutionSchema,
} from './schemas/playbook-evaluation-execution.schema';
import { Connector, ConnectorSchema } from '../connector/schemas/connector.schema';
import { Workspace, WorkspaceSchema } from '../workspace/schemas/workspace.schema';
import {
  WorkspaceSetting,
  WorkspaceSettingSchema,
} from '../workspace/schemas/workspace-setting.schema';

// Controllers — stream controller must be before playbook controller to avoid :id route conflict
import { PlaybookStreamController } from './controllers/playbook-stream.controller';
import { PlaybookController } from './controllers/playbook.controller';
import { PlaybookNodeAdvisorController } from './controllers/playbook-node-advisor.controller';
import { PlaybookExecutionController } from './controllers/playbook-execution.controller';
import { AdminPlaybookPromptsController } from './controllers/admin-playbook-prompts.controller';
import { AdminPlaybookSettingsController } from './controllers/admin-playbook-settings.controller';
import { AdminPlaybookNodeTemplatesController } from './controllers/admin-playbook-node-templates.controller';
import { PlaybookNodeTemplatesController } from './controllers/playbook-node-templates.controller';
// Services
import { PlaybookService } from './services/playbook.service';
import { PlaybookExecutionService } from './services/playbook-execution.service';
import { PlaybookGrpcService } from './services/playbook-grpc.service';
import { PlaybookContextService } from './services/playbook-context.service';
import { PlaybookDesignService } from './services/playbook-design.service';
import { PlaybookReplayService } from './services/playbook-replay.service';
import { PlaybookOutputFormatService } from './services/playbook-output-format.service';
import { PlaybookPromptService } from './services/playbook-prompt.service';
import { PlaybookNodeTemplateService } from './services/playbook-node-template.service';
import { PlaybookEvaluationService } from './services/playbook-evaluation.service';
import { PlaybookSemanticEnrichmentService } from './services/playbook-semantic-enrichment.service';
import { PlaybookJudgeEnrichmentService } from './services/playbook-judge-enrichment.service';
import { PlaybookStreamGatewayService } from './services/playbook-stream-gateway.service';
import { PlaybookScheduleRunnerService } from './services/playbook-schedule-runner.service';
import { PlaybookMailEventLedgerService } from './services/playbook-mail-event-ledger.service';
import { PlaybookMailEventIngestionService } from './services/playbook-mail-event-ingestion.service';
import { PlaybookMailTriggerMatcherService } from './services/playbook-mail-trigger-matcher.service';
import { PlaybookMailTriggerOrchestrationService } from './services/playbook-mail-trigger-orchestration.service';
import { PlaybookMailTriggerHandoffService } from './services/playbook-mail-trigger-handoff.service';
import { PlaybookMailTriggerTestEventService } from './services/playbook-mail-trigger-test-event.service';
import { PlaybookMailGraphClientService } from './services/playbook-mail-graph-client.service';
import { PlaybookMailSubscriptionRenewalService } from './services/playbook-mail-subscription-renewal.service';
import { PlaybookExecutionGraphService } from './services/playbook-execution-graph.service';
import { PlaybookExecutionNotificationService } from './services/playbook-execution-notification.service';
import { PlaybookExecutionBufferService } from './services/playbook-execution-buffer.service';
import { PlaybookExecutionAdvisorService } from './services/playbook-execution-advisor.service';
import { PlaybookRepeatabilityService } from './services/playbook-repeatability.service';
import { PlaybookSettingsService } from './services/playbook-settings.service';
import { PlaybookIntentService } from './services/playbook-intent.service';
import { PlaybookPromptTemplateRendererService } from './services/playbook-prompt-template-renderer.service';
import { PlaybookNodeAdvisorService } from './services/playbook-node-advisor.service';

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
import { ConnectorModule } from '../connector/connector.module';
import { ConnectedAppModule } from '../connected-app/connected-app.module';
import { AuthorizationModule } from '../authorization/authorization.module';
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
      { name: PlaybookNodeTemplate.name, schema: PlaybookNodeTemplateSchema },
      { name: PlaybookMailEventLedger.name, schema: PlaybookMailEventLedgerSchema },
      { name: PlaybookEvaluationBaseline.name, schema: PlaybookEvaluationBaselineSchema },
      { name: PlaybookEvaluationExecution.name, schema: PlaybookEvaluationExecutionSchema },
      { name: Connector.name, schema: ConnectorSchema },
      { name: Workspace.name, schema: WorkspaceSchema },
      { name: WorkspaceSetting.name, schema: WorkspaceSettingSchema },
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
    ConnectorModule,
    ConnectedAppModule,
    AuthorizationModule,
  ],
  controllers: [
    PlaybookStreamController, // Must be before PlaybookController to avoid route conflict with :id param
    PlaybookController,
    PlaybookNodeAdvisorController,
    PlaybookExecutionController,
    AdminPlaybookPromptsController,
    AdminPlaybookSettingsController,
    AdminPlaybookNodeTemplatesController,
    PlaybookNodeTemplatesController,
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
    PlaybookNodeTemplateService,
    PlaybookEvaluationService,
    PlaybookSemanticEnrichmentService,
    PlaybookJudgeEnrichmentService,
    PlaybookStreamGatewayService,
    PlaybookScheduleRunnerService,
    PlaybookMailEventLedgerService,
    PlaybookMailEventIngestionService,
    PlaybookMailTriggerMatcherService,
    PlaybookMailTriggerOrchestrationService,
    PlaybookMailTriggerHandoffService,
    PlaybookMailTriggerTestEventService,
    PlaybookMailGraphClientService,
    PlaybookMailSubscriptionRenewalService,
    PlaybookExecutionGraphService,
    PlaybookExecutionNotificationService,
    PlaybookExecutionBufferService,
    PlaybookExecutionAdvisorService,
    PlaybookRepeatabilityService,
    PlaybookSettingsService,
    PlaybookIntentService,
    PlaybookPromptTemplateRendererService,
    PlaybookNodeAdvisorService,
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
    PlaybookNodeTemplateService,
    PlaybookEvaluationService,
    PlaybookSemanticEnrichmentService,
    PlaybookJudgeEnrichmentService,
    PlaybookStreamGatewayService,
  ],
})
export class PlaybookModule {}
