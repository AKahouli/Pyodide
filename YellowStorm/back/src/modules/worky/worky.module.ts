import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WorkyStreamService } from './services/worky-stream.service';
import { WorkyElectricConsumerService } from './services/worky-electric-consumer.service';
import { WorkyEventService } from './services/worky-event.service';
import { WorkyAuditService } from './services/worky-audit.service';
import { WorkyOrchestratorGrpcClientService } from './services/worky-orchestrator.grpc-client.service';
import { WorkyPlanDeltaService } from './services/worky-plan-delta.service';
import { WorkyPlanningService } from './services/worky-planning.service';
import { WorkyTaskService } from './services/worky-task.service';
import { WorkyInteractionService } from './services/worky-interaction.service';
import { WorkyExecutionService } from './services/worky-execution.service';
import { WorkyGovernanceService } from './services/worky-governance.service';
import { WorkySchedulerService } from './services/worky-scheduler.service';
import { WorkyHumanAssignmentService } from './services/worky-human-assignment.service';
import { WorkyBudgetService } from './services/worky-budget.service';
import { WorkyReportService } from './services/worky-report.service';
import { WorkyMemoryService } from './services/worky-memory.service';
import { WorkyMemoryController } from './controllers/worky-memory.controller';
import { WorkyTraceService } from './services/worky-trace.service';
import { WorkyTraceController } from './controllers/worky-trace.controller';
import { WorkyTaskResultService } from './services/worky-task-result.service';
import { WorkyStreamController } from './controllers/worky-stream.controller';
import { WorkyEventsController } from './controllers/worky-events.controller';
import { WorkyMessageController } from './controllers/worky-message.controller';
import { WorkySttController } from './controllers/worky-stt.controller';
import { WorkySttService } from './services/worky-stt.service';
import { WorkyTtsController } from './controllers/worky-tts.controller';
import { WorkyTtsService } from './services/worky-tts.service';
import { WorkyVoiceController } from './voice/worky-voice.controller';
import { GeminiTokenService } from './voice/gemini-token.service';
import { VoiceToolService } from './voice/voice-tool.service';
import { ThematicMemoryService } from './voice/thematic-memory.service';
import { WorkyBoardController } from './controllers/worky-board.controller';
import { WorkyInteractionController } from './controllers/worky-interaction.controller';
import { WorkyTaskController } from './controllers/worky-task.controller';
import { WorkyGovernanceAdminController } from './controllers/admin/worky-governance-admin.controller';
import { WorkyStreamAccessGuard } from './guards/worky-stream-access.guard';
import { WorkyTaskStreamAccessGuard } from './guards/worky-task-stream-access.guard';
import { WorkyMailSubscriptionService } from './services/worky-mail-subscription.service';
import { WorkyTurnContextService } from './services/worky-turn-context.service';
import { WorkyTurnKickoffService } from './services/worky-turn-kickoff.service';
import { WorkyMailWebhookService } from './services/worky-mail-webhook.service';
import { WorkyMailRenewalService } from './services/worky-mail-renewal.service';
import { WorkyMailCatchupService } from './services/worky-mail-catchup.service';
import { WorkyTeamsCatchupService } from './services/worky-teams-catchup.service';
import { WorkyMailWebhookController } from './controllers/worky-mail-webhook.controller';
import { ConnectedAppModule } from '@modules/connected-app/connected-app.module';
import { WORKY_REPOSITORIES } from './persistence';
// Stateless Graph client, reused rather than reimplemented; worky provides the
// class directly instead of importing the whole PlaybookFlowModule for one service.
import { PlaybookFlowMailGraphClientService } from '@modules/playbook-flow/services/playbook-flow-mail-graph-client.service';
import workyConfig from '../../config/worky.config';
import workyOrchestratorConfig from '../../config/worky-orchestrator.config';
import workyOrchestratorSecurityConfig from '../../config/grpc-security-worky-orchestrator.config';
import { AgentTypeModule } from '../agent-type/agent-type.module';
import { AgentModule } from '../agent/agent.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { LoggerModule } from '../logger';
import { EmailModule } from '../email/email.module';
import { UserModule } from '../user/user.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ModelsModule } from '../models/models.module';
import { ConnectorModule } from '../connector/connector.module';

@Module({
  imports: [
    ConfigModule.forFeature(workyConfig),
    ConfigModule.forFeature(workyOrchestratorConfig),
    ConfigModule.forFeature(workyOrchestratorSecurityConfig),
    LoggerModule,
    AuthorizationModule,
    AgentTypeModule,
    AgentModule,
    EmailModule,
    UserModule,
    WorkspaceModule,
    ModelsModule,
    ConnectorModule,
    ConnectedAppModule,
  ],
  controllers: [
    WorkyStreamController,
    WorkyMailWebhookController,
    WorkyEventsController,
    WorkyMessageController,
    WorkySttController,
    WorkyTtsController,
    WorkyVoiceController,
    WorkyBoardController,
    WorkyInteractionController,
    WorkyTaskController,
    WorkyGovernanceAdminController,
    WorkyMemoryController,
    WorkyTraceController,
  ],
  providers: [
    ...WORKY_REPOSITORIES,
    WorkyStreamService,
    WorkyElectricConsumerService,
    WorkyEventService,
    WorkyAuditService,
    WorkyOrchestratorGrpcClientService,
    PlaybookFlowMailGraphClientService,
    WorkyMailSubscriptionService,
    WorkyTurnContextService,
    WorkyTurnKickoffService,
    WorkyMailWebhookService,
    WorkyMailRenewalService,
    WorkyMailCatchupService,
    WorkyTeamsCatchupService,
    WorkyPlanDeltaService,
    WorkyPlanningService,
    WorkyTaskService,
    WorkyInteractionService,
    WorkyExecutionService,
    WorkyGovernanceService,
    WorkySchedulerService,
    WorkyHumanAssignmentService,
    WorkyBudgetService,
    WorkyReportService,
    WorkyMemoryService,
    WorkyTraceService,
    WorkyTaskResultService,
    WorkySttService,
    WorkyTtsService,
    GeminiTokenService,
    VoiceToolService,
    ThematicMemoryService,
    WorkyStreamAccessGuard,
    WorkyTaskStreamAccessGuard,
  ],
  exports: [
    WorkyStreamService,
    WorkyEventService,
    WorkyAuditService,
    WorkyOrchestratorGrpcClientService,
    WorkyPlanDeltaService,
    WorkyPlanningService,
    WorkyTaskService,
    WorkyInteractionService,
    WorkyExecutionService,
    WorkyGovernanceService,
    WorkySchedulerService,
    WorkyHumanAssignmentService,
    WorkyBudgetService,
    WorkyReportService,
    WorkyMemoryService,
    WorkyTraceService,
    WorkyTaskResultService,
    WorkyStreamAccessGuard,
    WorkyTaskStreamAccessGuard,
  ],
})
export class WorkyModule {}
