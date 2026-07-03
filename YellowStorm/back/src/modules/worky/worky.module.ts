import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { WorkyStreamService } from './services/worky-stream.service';
import { WorkyIdempotencyService } from './services/worky-idempotency.service';
import { WorkyEventService } from './services/worky-event.service';
import { WorkyAuditService } from './services/worky-audit.service';
import { WorkyRuntimeClient } from './services/worky-runtime.client';
import { WorkyRuntimeDispatchService } from './services/worky-runtime-dispatch.service';
import { WorkyPlanDeltaService } from './services/worky-plan-delta.service';
import { WorkyPlanningService } from './services/worky-planning.service';
import { WorkyTaskService } from './services/worky-task.service';
import { WorkyInteractionService } from './services/worky-interaction.service';
import { WorkyExecutionService } from './services/worky-execution.service';
import { WorkyGovernanceService } from './services/worky-governance.service';
import { WorkyEphemeralWorkerService } from './services/worky-ephemeral-worker.service';
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
import { WorkyInternalController } from './controllers/worky-internal.controller';
import { WorkyMessageController } from './controllers/worky-message.controller';
import { WorkySttController } from './controllers/worky-stt.controller';
import { WorkySttService } from './services/worky-stt.service';
import { WorkyTtsController } from './controllers/worky-tts.controller';
import { WorkyTtsService } from './services/worky-tts.service';
import { WorkyBoardController } from './controllers/worky-board.controller';
import { WorkyInteractionController } from './controllers/worky-interaction.controller';
import { WorkyTaskController } from './controllers/worky-task.controller';
import { WorkyGovernanceAdminController } from './controllers/admin/worky-governance-admin.controller';
import { WorkyStreamAccessGuard } from './guards/worky-stream-access.guard';
import { WorkyTaskStreamAccessGuard } from './guards/worky-task-stream-access.guard';
import { WorkyServiceAuthGuard } from './guards/worky-service-auth.guard';
import {
  WorkyStream,
  WorkyStreamSchema,
} from './schemas/worky-stream.schema';
import {
  WorkyTask,
  WorkyTaskSchema,
} from './schemas/worky-task.schema';
import {
  WorkyMessage,
  WorkyMessageSchema,
} from './schemas/worky-message.schema';
import {
  WorkyPlanVersion,
  WorkyPlanVersionSchema,
} from './schemas/worky-plan-version.schema';
import {
  WorkyPlanDelta,
  WorkyPlanDeltaSchema,
} from './schemas/worky-plan-delta.schema';
import {
  WorkyInteraction,
  WorkyInteractionSchema,
} from './schemas/worky-interaction.schema';
import {
  WorkyExecutionSnapshot,
  WorkyExecutionSnapshotSchema,
} from './schemas/worky-execution-snapshot.schema';
import {
  WorkyEphemeralWorker,
  WorkyEphemeralWorkerSchema,
} from './schemas/worky-ephemeral-worker.schema';
import {
  WorkyTaskResult,
  WorkyTaskResultSchema,
} from './schemas/worky-task-result.schema';
import {
  WorkyCostEvent,
  WorkyCostEventSchema,
} from './schemas/worky-cost-event.schema';
import {
  WorkyTrace,
  WorkyTraceSchema,
} from './schemas/worky-trace.schema';
import {
  WorkyBudgetReservation,
  WorkyBudgetReservationSchema,
} from './schemas/worky-budget-reservation.schema';
import {
  WorkyMailEventLedger,
  WorkyMailEventLedgerSchema,
} from './schemas/worky-mail-event-ledger.schema';
import {
  WorkyIdempotencyRecord,
  WorkyIdempotencyRecordSchema,
} from './schemas/worky-idempotency-record.schema';
import {
  WorkyGovernancePolicy,
  WorkyGovernancePolicySchema,
} from './schemas/worky-governance-policy.schema';
import {
  WorkyScheduledEvent,
  WorkyScheduledEventSchema,
} from './schemas/worky-scheduled-event.schema';
import {
  WorkyExecutionReport,
  WorkyExecutionReportSchema,
} from './schemas/worky-execution-report.schema';
import {
  WorkyAuditEvent,
  WorkyAuditEventSchema,
} from './schemas/worky-audit-event.schema';
import {
  WorkyMemoryProposal,
  WorkyMemoryProposalSchema,
  WorkyMemoryEntry,
  WorkyMemoryEntrySchema,
} from './schemas/worky-memory.schema';
import {
  WorkyElectricCursor,
  WorkyElectricCursorSchema,
} from './schemas/worky-electric-cursor.schema';
import { Workspace, WorkspaceSchema } from '../workspace/schemas/workspace.schema';
import { Agent, AgentSchema } from '../agent/schemas/agent.schema';
import workyConfig from '../../config/worky.config';
import { AgentTypeModule } from '../agent-type/agent-type.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { LoggerModule } from '../logger';
import { EmailModule } from '../email/email.module';
import { UserModule } from '../user/user.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ModelsModule } from '../models/models.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { ConversationV2Module } from '../conversation-v2/conversation-v2.module';
import { WorkyWhatsAppIntegrationController } from './controllers/worky-whatsapp-integration.controller';
import {
  WorkyWhatsAppIntegration,
  WorkyWhatsAppIntegrationSchema,
} from './schemas/worky-whatsapp-integration.schema';
import {
  WorkyWhatsAppSystemBot,
  WorkyWhatsAppSystemBotSchema,
} from './schemas/worky-whatsapp-system-bot.schema';
import { WorkyWhatsAppIngressService } from './services/worky-whatsapp-ingress.service';
import { WorkyWhatsAppIntegrationService } from './services/worky-whatsapp-integration.service';
import { WorkyWhatsAppSystemBotService } from './services/worky-whatsapp-system-bot.service';
import { WorkyWhatsAppSystemBotAdminController } from './controllers/admin/worky-whatsapp-system-bot.controller';
import { WorkyWhatsAppSystemBotStatusController } from './controllers/worky-whatsapp-system-bot-status.controller';

@Module({
  imports: [
    ConfigModule.forFeature(workyConfig),
    LoggerModule,
    AuthorizationModule,
    AgentTypeModule,
    EmailModule,
    UserModule,
    WorkspaceModule,
    ModelsModule,
    forwardRef(() => WhatsAppModule),
    ConversationV2Module,
    MongooseModule.forFeature([
      { name: WorkyStream.name, schema: WorkyStreamSchema },
      { name: WorkyTask.name, schema: WorkyTaskSchema },
      { name: WorkyMessage.name, schema: WorkyMessageSchema },
      { name: WorkyPlanVersion.name, schema: WorkyPlanVersionSchema },
      { name: WorkyPlanDelta.name, schema: WorkyPlanDeltaSchema },
      { name: WorkyInteraction.name, schema: WorkyInteractionSchema },
      { name: WorkyExecutionSnapshot.name, schema: WorkyExecutionSnapshotSchema },
      { name: WorkyEphemeralWorker.name, schema: WorkyEphemeralWorkerSchema },
      { name: WorkyTaskResult.name, schema: WorkyTaskResultSchema },
      { name: WorkyCostEvent.name, schema: WorkyCostEventSchema },
      { name: WorkyTrace.name, schema: WorkyTraceSchema },
      { name: WorkyBudgetReservation.name, schema: WorkyBudgetReservationSchema },
      { name: WorkyMailEventLedger.name, schema: WorkyMailEventLedgerSchema },
      { name: WorkyIdempotencyRecord.name, schema: WorkyIdempotencyRecordSchema },
      { name: WorkyGovernancePolicy.name, schema: WorkyGovernancePolicySchema },
      { name: WorkyScheduledEvent.name, schema: WorkyScheduledEventSchema },
      { name: WorkyExecutionReport.name, schema: WorkyExecutionReportSchema },
      { name: WorkyAuditEvent.name, schema: WorkyAuditEventSchema },
      { name: WorkyMemoryProposal.name, schema: WorkyMemoryProposalSchema },
      { name: WorkyMemoryEntry.name, schema: WorkyMemoryEntrySchema },
      { name: WorkyElectricCursor.name, schema: WorkyElectricCursorSchema },
      // Re-registered here so WorkyStreamService can inject them directly
      // without pulling in AgentModule/WorkspaceModule's full transitive
      // dependency graph. Nest reuses the same Mongoose model instance via DI.
      { name: Workspace.name, schema: WorkspaceSchema },
      { name: Agent.name, schema: AgentSchema },
      { name: WorkyWhatsAppIntegration.name, schema: WorkyWhatsAppIntegrationSchema },
      { name: WorkyWhatsAppSystemBot.name, schema: WorkyWhatsAppSystemBotSchema },
    ]),
  ],
  controllers: [
    WorkyStreamController,
    WorkyEventsController,
    WorkyInternalController,
    WorkyMessageController,
    WorkySttController,
    WorkyTtsController,
    WorkyBoardController,
    WorkyInteractionController,
    WorkyTaskController,
    WorkyGovernanceAdminController,
    WorkyWhatsAppSystemBotAdminController,
    WorkyWhatsAppSystemBotStatusController,
    WorkyMemoryController,
    WorkyTraceController,
    WorkyWhatsAppIntegrationController,
  ],
  providers: [
    WorkyStreamService,
    WorkyIdempotencyService,
    WorkyEventService,
    WorkyAuditService,
    WorkyRuntimeClient,
    WorkyRuntimeDispatchService,
    WorkyPlanDeltaService,
    WorkyPlanningService,
    WorkyTaskService,
    WorkyInteractionService,
    WorkyExecutionService,
    WorkyGovernanceService,
    WorkyEphemeralWorkerService,
    WorkySchedulerService,
    WorkyHumanAssignmentService,
    WorkyBudgetService,
    WorkyReportService,
    WorkyMemoryService,
    WorkyTraceService,
    WorkyTaskResultService,
    WorkySttService,
    WorkyTtsService,
    WorkyWhatsAppIngressService,
    WorkyWhatsAppIntegrationService,
    WorkyWhatsAppSystemBotService,
    WorkyStreamAccessGuard,
    WorkyTaskStreamAccessGuard,
    WorkyServiceAuthGuard,
  ],
  exports: [
    WorkyStreamService,
    WorkyIdempotencyService,
    WorkyEventService,
    WorkyAuditService,
    WorkyRuntimeClient,
    WorkyRuntimeDispatchService,
    WorkyPlanDeltaService,
    WorkyPlanningService,
    WorkyTaskService,
    WorkyInteractionService,
    WorkyExecutionService,
    WorkyGovernanceService,
    WorkyEphemeralWorkerService,
    WorkySchedulerService,
    WorkyHumanAssignmentService,
    WorkyBudgetService,
    WorkyReportService,
    WorkyMemoryService,
    WorkyTraceService,
    WorkyTaskResultService,
    WorkyWhatsAppIngressService,
    WorkyWhatsAppIntegrationService,
    WorkyWhatsAppSystemBotService,
    WorkyStreamAccessGuard,
    WorkyTaskStreamAccessGuard,
    WorkyServiceAuthGuard,
  ],
})
export class WorkyModule {}
