import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '@modules/auth/auth.module';
import { AuthorizationModule } from '@modules/authorization/authorization.module';
import { LoggerModule, LoggerService } from '@modules/logger';
import { AgentModule } from '@modules/agent/agent.module';
import { ModelsModule } from '@modules/models/models.module';
import { UsageModule } from '@modules/usage/usage.module';
import { WorkspaceModule } from '@modules/workspace/workspace.module';
import { ConnectedAppModule } from '@modules/connected-app/connected-app.module';
import { WorkspaceSchema, Workspace } from '@modules/workspace/schemas/workspace.schema';
import {
  WorkspaceSetting,
  WorkspaceSettingSchema,
} from '@modules/workspace/schemas/workspace-setting.schema';

import playbookFlowConfig from '@config/playbook-flow.config';

import { Flow, FlowSchema } from './schemas/playbook-flow.schema';
import { FlowExecution, FlowExecutionSchema } from './schemas/playbook-flow-execution.schema';
import { FlowTaskResult, FlowTaskResultSchema } from './schemas/playbook-flow-task-result.schema';
import { FlowRouterDecision, FlowRouterDecisionSchema } from './schemas/playbook-flow-router-decision.schema';
import { FlowNodeTemplate, FlowNodeTemplateSchema } from './schemas/playbook-flow-node-template.schema';
import { FlowPromptTemplate, FlowPromptTemplateSchema } from './schemas/playbook-flow-prompt-template.schema';
import { FlowOutputFormat, FlowOutputFormatSchema } from './schemas/playbook-flow-output-format.schema';
import { FlowDesignMessage, FlowDesignMessageSchema } from './schemas/playbook-flow-design-message.schema';
import { FlowValidatedReplay, FlowValidatedReplaySchema } from './schemas/playbook-flow-validated-replay.schema';
import { FlowEvaluationBaseline, FlowEvaluationBaselineSchema } from './schemas/playbook-flow-evaluation-baseline.schema';
import { FlowEvaluationExecution, FlowEvaluationExecutionSchema } from './schemas/playbook-flow-evaluation-execution.schema';
import { FlowMailEventLedger, FlowMailEventLedgerSchema } from './schemas/playbook-flow-mail-event-ledger.schema';
import { FlowIdempotencyRecord, FlowIdempotencyRecordSchema } from './schemas/playbook-flow-idempotency-record.schema';

import { PlaybookFlowController } from './controllers/playbook-flow.controller';
import { PlaybookFlowExecutionController } from './controllers/playbook-flow-execution.controller';
import { PlaybookFlowMailWebhookController } from './controllers/playbook-flow-mail-webhook.controller';
import { PlaybookFlowTemplateController } from './controllers/playbook-flow-template.controller';
import { PlaybookFlowRepeatabilityController } from './controllers/playbook-flow-repeatability.controller';
import { PlaybookFlowTriggerController } from './controllers/playbook-flow-trigger.controller';
import { PlaybookFlowReplayController } from './controllers/playbook-flow-replay.controller';
import { PlaybookFlowOutputFormatController } from './controllers/playbook-flow-output-format.controller';
import { PlaybookFlowAdvisorController } from './controllers/playbook-flow-advisor.controller';
import { PlaybookFlowExecutionAdvisorController } from './controllers/playbook-flow-execution-advisor.controller';
import { PlaybookFlowStreamController } from './controllers/playbook-flow-stream.controller';
import { PlaybookFlowPromptTemplateController } from './controllers/playbook-flow-prompt-template.controller';
import { PlaybookFlowSettingsController } from './controllers/playbook-flow-settings.controller';

import { PlaybookFlowService } from './services/playbook-flow.service';
import { PlaybookFlowReplayService } from './services/playbook-flow-replay.service';
import { PlaybookFlowEvaluationService } from './services/playbook-flow-evaluation.service';
import { PlaybookFlowRepeatabilityService } from './services/playbook-flow-repeatability.service';
import { PlaybookFlowScheduleService } from './services/playbook-flow-schedule.service';
import { PlaybookFlowValidatorService } from './services/playbook-flow-validator.service';
import { PlaybookFlowBuilderService } from './services/playbook-flow-builder.service';
import { PlaybookFlowExecutionService } from './services/playbook-flow-execution.service';
import { PlaybookFlowResultsService } from './services/playbook-flow-results.service';
import { PlaybookFlowQueueService } from './services/playbook-flow-queue.service';
import { PlaybookFlowIdempotencyService } from './services/playbook-flow-idempotency.service';
import { PlaybookFlowNodeTemplateService } from './services/playbook-flow-node-template.service';
import { PlaybookFlowPromptTemplateService } from './services/playbook-flow-prompt-template.service';
import { PlaybookFlowPromptRendererService } from './services/playbook-flow-prompt-renderer.service';
import { PlaybookFlowSettingsService } from './services/playbook-flow-settings.service';
import { PlaybookFlowContextService } from './services/playbook-flow-context.service';
import { PlaybookFlowOutputFormatService } from './services/playbook-flow-output-format.service';
import { PlaybookFlowDesignService } from './services/playbook-flow-design.service';
import { PlaybookFlowAdvisorService } from './services/playbook-flow-advisor.service';
import { PlaybookFlowAdvisorModelService } from './services/advisor/playbook-flow-advisor-model.service';
import { PlaybookFlowExecutionAdvisorService } from './services/advisor/playbook-flow-execution-advisor.service';
import { PlaybookFlowExecutionAdvisorMapper } from './services/advisor/playbook-flow-execution-advisor.mapper';
import { PlaybookFlowHeuristicAdvisorEvaluatorService } from './services/advisor/playbook-flow-heuristic-advisor-evaluator.service';
import { PlaybookFlowLlmAdvisorEvaluatorService } from './services/advisor/playbook-flow-llm-advisor-evaluator.service';
import { PlaybookFlowDesignGrpcService } from './services/playbook-flow-design-grpc.service';
import { PlaybookFlowMailWebhookService } from './services/playbook-flow-mail-webhook.service';
import { PlaybookFlowMailGraphClientService } from './services/playbook-flow-mail-graph-client.service';
import { PlaybookFlowMailEventLedgerService } from './services/playbook-flow-mail-event-ledger.service';
import { PlaybookFlowMailEventIngestionService } from './services/playbook-flow-mail-event-ingestion.service';
import { PlaybookFlowMailTriggerMatcherService } from './services/playbook-flow-mail-trigger-matcher.service';
import { PlaybookFlowMailTriggerOrchestrationService } from './services/playbook-flow-mail-trigger-orchestration.service';
import { PlaybookFlowMailTriggerHandoffService } from './services/playbook-flow-mail-trigger-handoff.service';
import { PlaybookFlowMailSubscriptionRenewalService } from './services/playbook-flow-mail-subscription-renewal.service';
import { PlaybookFlowStreamGatewayService } from './services/playbook-flow-stream-gateway.service';
import { PlaybookFlowStreamEventsService } from './services/playbook-flow-stream-events.service';
import { PlaybookFlowIntentService } from './services/playbook-flow-intent.service';
import { PlaybookFlowStreamAuthGuard } from './guards/playbook-flow-stream-auth.guard';
import { PlaybookFlowObservabilityService } from './services/observability/playbook-flow-observability.service';
import { PlaybookFlowPublicReasoningParserService } from './services/observability/playbook-flow-public-reasoning-parser.service';
import { PlaybookFlowTraceRedactionService } from './services/observability/playbook-flow-trace-redaction.service';
import { PlaybookFlowReplayArtifactService } from './services/playbook-flow-replay-artifact.service';
import { PlaybookFlowReplayPromptService } from './services/playbook-flow-replay-prompt.service';

@Module({
  imports: [
    ConfigModule.forFeature(playbookFlowConfig),
    MongooseModule.forFeature([
      { name: Flow.name, schema: FlowSchema },
      { name: FlowExecution.name, schema: FlowExecutionSchema },
      { name: FlowTaskResult.name, schema: FlowTaskResultSchema },
      { name: FlowRouterDecision.name, schema: FlowRouterDecisionSchema },
      { name: FlowNodeTemplate.name, schema: FlowNodeTemplateSchema },
      { name: FlowPromptTemplate.name, schema: FlowPromptTemplateSchema },
      { name: FlowOutputFormat.name, schema: FlowOutputFormatSchema },
      { name: FlowDesignMessage.name, schema: FlowDesignMessageSchema },
      { name: FlowValidatedReplay.name, schema: FlowValidatedReplaySchema },
      { name: FlowEvaluationBaseline.name, schema: FlowEvaluationBaselineSchema },
      { name: FlowEvaluationExecution.name, schema: FlowEvaluationExecutionSchema },
      { name: FlowMailEventLedger.name, schema: FlowMailEventLedgerSchema },
      { name: FlowIdempotencyRecord.name, schema: FlowIdempotencyRecordSchema },
      { name: Workspace.name, schema: WorkspaceSchema },
      { name: WorkspaceSetting.name, schema: WorkspaceSettingSchema },
    ]),
    JwtModule.register({}),
    AuthModule,
    AuthorizationModule,
    LoggerModule,
    AgentModule,
    ModelsModule,
    UsageModule,
    WorkspaceModule,
    ConnectedAppModule,
  ],
  controllers: [
    PlaybookFlowMailWebhookController,
    PlaybookFlowTemplateController,
    PlaybookFlowExecutionController,
    PlaybookFlowController,
    PlaybookFlowRepeatabilityController,
    PlaybookFlowTriggerController,
    PlaybookFlowReplayController,
    PlaybookFlowOutputFormatController,
    PlaybookFlowAdvisorController,
    PlaybookFlowExecutionAdvisorController,
    PlaybookFlowStreamController,
    PlaybookFlowPromptTemplateController,
    PlaybookFlowSettingsController,
  ],
  providers: [
    PlaybookFlowService,
    PlaybookFlowValidatorService,
    PlaybookFlowBuilderService,
    PlaybookFlowExecutionService,
    PlaybookFlowResultsService,
    PlaybookFlowQueueService,
    PlaybookFlowIdempotencyService,
    PlaybookFlowNodeTemplateService,
    PlaybookFlowPromptTemplateService,
    PlaybookFlowPromptRendererService,
    PlaybookFlowSettingsService,
    PlaybookFlowContextService,
    PlaybookFlowOutputFormatService,
    PlaybookFlowDesignService,
    PlaybookFlowAdvisorService,
    PlaybookFlowAdvisorModelService,
    PlaybookFlowHeuristicAdvisorEvaluatorService,
    PlaybookFlowLlmAdvisorEvaluatorService,
    PlaybookFlowExecutionAdvisorService,
    PlaybookFlowExecutionAdvisorMapper,
    PlaybookFlowDesignGrpcService,
    PlaybookFlowReplayService,
    PlaybookFlowEvaluationService,
    PlaybookFlowRepeatabilityService,
    PlaybookFlowScheduleService,
    PlaybookFlowMailWebhookService,
    PlaybookFlowMailGraphClientService,
    PlaybookFlowMailEventLedgerService,
    PlaybookFlowMailEventIngestionService,
    PlaybookFlowMailTriggerMatcherService,
    PlaybookFlowMailTriggerOrchestrationService,
    PlaybookFlowMailTriggerHandoffService,
    PlaybookFlowMailSubscriptionRenewalService,
    PlaybookFlowStreamGatewayService,
    PlaybookFlowStreamEventsService,
    PlaybookFlowIntentService,
    PlaybookFlowStreamAuthGuard,
    PlaybookFlowObservabilityService,
    PlaybookFlowPublicReasoningParserService,
    PlaybookFlowTraceRedactionService,
    PlaybookFlowReplayArtifactService,
    PlaybookFlowReplayPromptService,
  ],
  exports: [
    PlaybookFlowService,
    PlaybookFlowExecutionService,
    PlaybookFlowBuilderService,
    PlaybookFlowValidatorService,
    PlaybookFlowResultsService,
    PlaybookFlowNodeTemplateService,
    PlaybookFlowPromptTemplateService,
    PlaybookFlowPromptRendererService,
    PlaybookFlowSettingsService,
    PlaybookFlowDesignService,
    PlaybookFlowAdvisorService,
    PlaybookFlowReplayService,
    PlaybookFlowEvaluationService,
    PlaybookFlowRepeatabilityService,
    PlaybookFlowObservabilityService,
  ],
})
export class PlaybookFlowModule {}
