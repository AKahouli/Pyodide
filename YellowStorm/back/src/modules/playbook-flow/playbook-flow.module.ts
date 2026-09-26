import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '@modules/auth/auth.module';
import { AuthorizationModule } from '@modules/authorization/authorization.module';
import { LoggerModule, LoggerService } from '@modules/logger';
import { AgentModule } from '@modules/agent/agent.module';
import { SkillModule } from '@modules/skill/skill.module';
import { ConnectorModule } from '@modules/connector/connector.module';
import { ModelsModule } from '@modules/models/models.module';
import { UsageModule } from '@modules/usage/usage.module';
import { WorkspaceModule } from '@modules/workspace/workspace.module';
import { ConnectedAppModule } from '@modules/connected-app/connected-app.module';
import { UserModule } from '@modules/user';
import { ConversationModule } from '@modules/conversation/conversation.module';

import playbookFlowConfig from '@config/playbook-flow.config';
import { PLAYBOOK_REPOSITORIES } from './persistence';


import { PlaybookFlowController } from './controllers/playbook-flow.controller';
import { PlaybookFlowExecutionController } from './controllers/playbook-flow-execution.controller';
import { PlaybookFlowArtifactController } from './controllers/playbook-flow-artifact.controller';
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
import { PlaybookFlowHitlController } from './controllers/playbook-flow-hitl.controller';
import { PlaybookShareController } from './controllers/playbook-share.controller';
import { PlaybookAssistantInternalController } from './controllers/playbook-assistant-internal.controller';
import { PlaybookFlowInternalArtifactController } from './controllers/playbook-flow-internal-artifact.controller';

import { PlaybookFlowService } from './services/playbook-flow.service';
import { PlaybookShareService } from './services/playbook-share.service';
import { PlaybookFlowReplayService } from './services/playbook-flow-replay.service';
import { PlaybookFlowEvaluationService } from './services/playbook-flow-evaluation.service';
import { PlaybookFlowRepeatabilityService } from './services/playbook-flow-repeatability.service';
import { PlaybookFlowScheduleService } from './services/playbook-flow-schedule.service';
import { PlaybookFlowValidatorService } from './services/playbook-flow-validator.service';
import { PlaybookFlowBuilderService } from './services/playbook-flow-builder.service';
import { PlaybookFlowExecutionService } from './services/playbook-flow-execution.service';
import { PlaybookFlowArtifactService } from './services/playbook-flow-artifact.service';
import { PlaybookFlowResultsService } from './services/playbook-flow-results.service';
import { PlaybookFlowQueueService } from './services/playbook-flow-queue.service';
import { PlaybookFlowIdempotencyService } from './services/playbook-flow-idempotency.service';
import { PlaybookFlowNodeTemplateService } from './services/playbook-flow-node-template.service';
import { PlaybookFlowPromptTemplateService } from './services/playbook-flow-prompt-template.service';
import { PlaybookFlowPromptRendererService } from './services/playbook-flow-prompt-renderer.service';
import { PlaybookFlowSettingsService } from './services/playbook-flow-settings.service';
import { PlaybookExecutionSettingsResolverService } from './services/playbook-execution-settings-resolver.service';
import { PlaybookFlowContextService } from './services/playbook-flow-context.service';
import { PlaybookFlowOutputFormatService } from './services/playbook-flow-output-format.service';
import { PlaybookFlowDesignService } from './services/playbook-flow-design.service';
import { PlaybookFlowDesignOperationService } from './services/playbook-flow-design-operation.service';
import { PlaybookFlowAdvisorService } from './services/playbook-flow-advisor.service';
import { PlaybookFlowAdvisorModelService } from './services/advisor/playbook-flow-advisor-model.service';
import { PlaybookFlowAdvisorScriptReplacementService } from './services/advisor/playbook-flow-advisor-script-replacement.service';
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
import { PlaybookFlowExecutionLeaseService } from './services/playbook-flow-execution-lease.service';
import { PlaybookFlowTokenBufferService } from './services/playbook-flow-token-buffer.service';
import { PlaybookFlowIntentService } from './services/playbook-flow-intent.service';
import { PlaybookFlowIntentConstructionService } from './services/playbook-flow-intent-construction.service';
import { PlaybookFlowIntentTraceService } from './services/playbook-flow-intent-trace.service';
import { PlaybookIntentGraphBindingResolverService } from './services/playbook-intent-graph-binding-resolver.service';
import { PlaybookIntentBlueprintParserService } from './services/playbook-intent-blueprint-parser.service';
import { PlaybookIntentGraphBuilderService } from './services/playbook-intent-graph-builder.service';
import { PlaybookIntentSuggestionDiagnosticsService } from './services/playbook-intent-suggestion-diagnostics.service';
import { PlaybookIntentSuggestionNormalizerService } from './services/playbook-intent-suggestion-normalizer.service';
import { PlaybookFlowPrimitiveRegistryService } from './services/playbook-flow-primitive-registry.service';
import { PlaybookIntentBlueprintRepairService } from './services/playbook-intent-blueprint-repair.service';
import { PlaybookIntentBlueprintCompilerService } from './services/playbook-intent-blueprint-compiler.service';
import { PlaybookInputContractService } from './services/playbook-input-contract.service';
import { PlaybookIntentExternalInputNormalizerService } from './services/playbook-intent-external-input-normalizer.service';
import { PlaybookFlowStreamAuthGuard } from './guards/playbook-flow-stream-auth.guard';
import { PlaybookFlowObservabilityService } from './services/observability/playbook-flow-observability.service';
import { PlaybookFlowPublicReasoningParserService } from './services/observability/playbook-flow-public-reasoning-parser.service';
import { PlaybookFlowTraceRedactionService } from './services/observability/playbook-flow-trace-redaction.service';
import { PlaybookFlowReplayArtifactService } from './services/playbook-flow-replay-artifact.service';
import { PlaybookFlowReplayPromptService } from './services/playbook-flow-replay-prompt.service';
import { PlaybookFlowReplayHashService } from './services/playbook-flow-replay-hash.service';
import { PlaybookFlowReplayBaselineService } from './services/playbook-flow-replay-baseline.service';
import { PlaybookFlowReplayReportService } from './services/playbook-flow-replay-report.service';
import { PlaybookFlowReplayDriftService } from './services/playbook-flow-replay-drift.service';
import { PlaybookFlowReplayPlanService } from './services/playbook-flow-replay-plan.service';
import { PlaybookFlowOutputContractService } from './services/playbook-flow-output-contract.service';
import { PlaybookFlowHitlService } from './services/playbook-flow-hitl.service';
import { PlaybookFlowHitlBlockerService } from './services/playbook-flow-hitl-blocker.service';
import { PlaybookFlowHitlContextService } from './services/playbook-flow-hitl-context.service';
import { PlaybookFlowHitlMemoryService } from './services/playbook-flow-hitl-memory.service';
import { PlaybookFlowHitlPromptService } from './services/playbook-flow-hitl-prompt.service';
import { PlaybookFlowReplaySemanticJudgeService } from './services/playbook-flow-replay-semantic-judge.service';
import { PlaybookFlowReplayPostRunEvaluationService } from './services/playbook-flow-replay-post-run-evaluation.service';
import { FlowAccessService } from './domain/flow-access.service';
import { FlowResponseAssemblerService } from './domain/flow-response-assembler.service';
import { FlowWorkspacePolicyService } from './domain/flow-workspace-policy.service';
import { FlowGraphSanitizerService } from './domain/flow-graph-sanitizer.service';
import { FlowDeltaPatchService } from './domain/flow-delta-patch.service';
import { PlaybookFlowRuntimeClientService } from './execution/grpc/playbook-flow-runtime-client.service';
import { PlaybookExecutionDispatcherService } from './execution/runtime/playbook-execution-dispatcher.service';
import { PlaybookExecutionEventHandlerService } from './execution/runtime/playbook-execution-event-handler.service';
import { PlaybookExecutionNodeEventHandlerService } from './execution/runtime/playbook-execution-node-event-handler.service';
import { PlaybookExecutionReplayRuntimeService } from './execution/runtime/playbook-execution-replay-runtime.service';
import { PlaybookExecutionStreamFinalizerService } from './execution/runtime/playbook-execution-stream-finalizer.service';
import { PlaybookExecutionHitlResumeService } from './execution/runtime/playbook-execution-hitl-resume.service';
import { PlaybookExecutionSingleStepPrepService } from './execution/runtime/playbook-execution-single-step-prep.service';
import { PlaybookDynamicReasoningEventHandlerService } from './execution/runtime/playbook-dynamic-reasoning-event-handler.service';
import { PlaybookExecutionNodeAgentMetadataService } from './execution/runtime/playbook-execution-node-agent-metadata.service';
import { PlaybookDesignRequestBuilderService } from './design/playbook-design-request-builder.service';
import { PlaybookDesignResultApplierService } from './design/playbook-design-result-applier.service';
import { PlaybookDesignSummaryService } from './design/playbook-design-summary.service';
import { PlaybookAssistantContextService } from './assistant/playbook-assistant-context.service';
import { PlaybookAssistantService } from './assistant/playbook-assistant.service';
import { PlaybookAssistantOperationService } from './assistant/playbook-assistant-operation.service';
import { PlaybookPlanValidationClientService } from './assistant/playbook-plan-validation-client.service';
import { PlaybookAssistantRequestService } from './assistant/playbook-assistant-request.service';
import { PlaybookAssistantHistoryService } from './assistant/playbook-assistant-history.service';
import { PlaybookAssistantActorGuard } from './guards/playbook-assistant-actor.guard';
import { PlaybookAssistantAttachmentService } from './assistant/playbook-assistant-attachment.service';

@Module({
  imports: [
    ConfigModule.forFeature(playbookFlowConfig),
    JwtModule.register({}),
    AuthModule,
    AuthorizationModule,
    LoggerModule,
    AgentModule,
    SkillModule,
    ConnectorModule,
    ModelsModule,
    UsageModule,
    WorkspaceModule,
    ConnectedAppModule,
    UserModule,
    ConversationModule,
  ],
  controllers: [
    // The stream controller must register before PlaybookFlowController so the
    // static GET /playbooks/stream route is not shadowed by GET /playbooks/:id.
    PlaybookFlowStreamController,
    PlaybookFlowMailWebhookController,
    PlaybookFlowTemplateController,
    PlaybookFlowExecutionController,
    PlaybookFlowArtifactController,
    PlaybookFlowController,
    PlaybookFlowRepeatabilityController,
    PlaybookFlowTriggerController,
    PlaybookFlowReplayController,
    PlaybookFlowOutputFormatController,
    PlaybookFlowAdvisorController,
    PlaybookFlowExecutionAdvisorController,
    PlaybookFlowPromptTemplateController,
    PlaybookFlowSettingsController,
    PlaybookFlowHitlController,
    PlaybookShareController,
    PlaybookAssistantInternalController,
    PlaybookFlowInternalArtifactController,
  ],
  providers: [
    ...PLAYBOOK_REPOSITORIES,
    PlaybookFlowService,
    PlaybookShareService,
    FlowAccessService,
    FlowResponseAssemblerService,
    FlowWorkspacePolicyService,
    FlowGraphSanitizerService,
    FlowDeltaPatchService,
    PlaybookFlowRuntimeClientService,
    PlaybookExecutionDispatcherService,
    PlaybookExecutionEventHandlerService,
    PlaybookExecutionNodeEventHandlerService,
    PlaybookExecutionReplayRuntimeService,
    PlaybookExecutionStreamFinalizerService,
    PlaybookExecutionHitlResumeService,
    PlaybookExecutionSingleStepPrepService,
    PlaybookExecutionNodeAgentMetadataService,
    PlaybookDynamicReasoningEventHandlerService,
    PlaybookDesignRequestBuilderService,
    PlaybookDesignResultApplierService,
    PlaybookDesignSummaryService,
    PlaybookFlowValidatorService,
    PlaybookFlowBuilderService,
    PlaybookFlowExecutionService,
    PlaybookFlowArtifactService,
    PlaybookFlowResultsService,
    PlaybookFlowQueueService,
    PlaybookFlowIdempotencyService,
    PlaybookFlowNodeTemplateService,
    PlaybookFlowPromptTemplateService,
    PlaybookFlowPromptRendererService,
    PlaybookFlowSettingsService,
    PlaybookExecutionSettingsResolverService,
    PlaybookFlowContextService,
    PlaybookFlowOutputFormatService,
    PlaybookFlowDesignService,
    PlaybookFlowDesignOperationService,
    PlaybookFlowAdvisorService,
    PlaybookFlowAdvisorModelService,
    PlaybookFlowAdvisorScriptReplacementService,
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
    PlaybookFlowExecutionLeaseService,
    PlaybookFlowTokenBufferService,
    PlaybookFlowIntentService,
    PlaybookFlowIntentConstructionService,
    PlaybookFlowIntentTraceService,
    PlaybookIntentGraphBindingResolverService,
    PlaybookIntentBlueprintParserService,
    PlaybookIntentGraphBuilderService,
    PlaybookIntentSuggestionDiagnosticsService,
    PlaybookIntentSuggestionNormalizerService,
    PlaybookIntentBlueprintRepairService,
    PlaybookIntentBlueprintCompilerService,
    PlaybookInputContractService,
    PlaybookIntentExternalInputNormalizerService,
    PlaybookFlowPrimitiveRegistryService,
    PlaybookFlowStreamAuthGuard,
    PlaybookFlowObservabilityService,
    PlaybookFlowPublicReasoningParserService,
    PlaybookFlowTraceRedactionService,
    PlaybookFlowReplayArtifactService,
    PlaybookFlowReplayPromptService,
    PlaybookFlowReplayHashService,
    PlaybookFlowReplayBaselineService,
    PlaybookFlowReplayReportService,
    PlaybookFlowReplayDriftService,
    PlaybookFlowReplayPlanService,
    PlaybookFlowOutputContractService,
    PlaybookFlowHitlService,
    PlaybookFlowHitlBlockerService,
    PlaybookFlowHitlContextService,
    PlaybookFlowHitlMemoryService,
    PlaybookFlowHitlPromptService,
    PlaybookFlowReplaySemanticJudgeService,
    PlaybookFlowReplayPostRunEvaluationService,
    PlaybookAssistantContextService,
    PlaybookAssistantService,
    PlaybookAssistantOperationService,
    PlaybookPlanValidationClientService,
    PlaybookAssistantRequestService,
    PlaybookAssistantHistoryService,
    PlaybookAssistantActorGuard,
    PlaybookAssistantAttachmentService,
  ],
  exports: [
    PlaybookFlowService,
    PlaybookShareService,
    FlowAccessService,
    FlowResponseAssemblerService,
    FlowWorkspacePolicyService,
    FlowGraphSanitizerService,
    FlowDeltaPatchService,
    PlaybookFlowExecutionService,
    PlaybookFlowBuilderService,
    PlaybookFlowValidatorService,
    PlaybookFlowResultsService,
    PlaybookFlowNodeTemplateService,
    PlaybookFlowPromptTemplateService,
    PlaybookFlowPromptRendererService,
    PlaybookFlowSettingsService,
    PlaybookExecutionSettingsResolverService,
    PlaybookFlowDesignService,
    PlaybookFlowAdvisorService,
    PlaybookFlowReplayService,
    PlaybookFlowEvaluationService,
    PlaybookFlowRepeatabilityService,
    PlaybookFlowObservabilityService,
    PlaybookPlanValidationClientService,
  ],
})
export class PlaybookFlowModule {}
