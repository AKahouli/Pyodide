import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthorizationModule } from '@modules/authorization';
import { LoggerModule } from '@modules/logger';
import { ConversationModule } from '@modules/conversation/conversation.module';
import { WidgetChatModule } from '@modules/widget-chat/widget-chat.module';
import { WhatsAppModule } from '@modules/whatsapp';
import { TelegramModule } from '@modules/telegram';
import { UserGroupModule } from '@modules/user-group';
import { GovernanceProgramController } from './controllers/governance-program.controller';
import { GovernanceScopeController } from './controllers/governance-scope.controller';
import { GovernanceSourceController } from './controllers/governance-source.controller';
import { GovernanceMembershipController } from './controllers/governance-membership.controller';
import { GovernanceDeploymentController } from './controllers/governance-deployment.controller';
import { GovernanceDryRunController } from './controllers/governance-dry-run.controller';
import { GovernanceMetricController } from './controllers/governance-metric.controller';
import { GovernanceProgramService } from './services/governance-program.service';
import { GovernanceScopeService } from './services/governance-scope.service';
import { GovernanceSourceService } from './services/governance-source.service';
import { GovernanceMembershipService } from './services/governance-membership.service';
import { GovernanceAccessService } from './services/governance-access.service';
import { GovernanceDeploymentService } from './services/governance-deployment.service';
import { GovernanceDryRunService } from './services/governance-dry-run.service';
import { GovernanceMetricService } from './services/governance-metric.service';
import { GovernanceChannelReadinessService } from './services/governance-channel-readiness.service';
import { GovernanceScopeOverviewService } from './services/governance-scope-overview.service';
import { GovernanceProgram, GovernanceProgramSchema } from './schemas/governance-program.schema';
import { GovernanceScope, GovernanceScopeSchema } from './schemas/governance-scope.schema';
import { GovernanceSource, GovernanceSourceSchema } from './schemas/governance-source.schema';
import { GovernanceMembership, GovernanceMembershipSchema } from './schemas/governance-membership.schema';
import { GovernanceDeployment, GovernanceDeploymentSchema } from './schemas/governance-deployment.schema';
import { GovernanceDeploymentRevision, GovernanceDeploymentRevisionSchema } from './schemas/governance-deployment-revision.schema';
import { GovernanceDryRun, GovernanceDryRunSchema } from './schemas/governance-dry-run.schema';
import { GovernanceMetric, GovernanceMetricSchema } from './schemas/governance-metric.schema';
import { GovernanceSourceVersion, GovernanceSourceVersionSchema } from './schemas/governance-source-version.schema';
import { GovernanceSourceEvent, GovernanceSourceEventSchema } from './schemas/governance-source-event.schema';
import { GovernanceWorkspaceBinding, GovernanceWorkspaceBindingSchema } from './schemas/governance-workspace-binding.schema';
import { GovernanceWorkspaceBindingController } from './controllers/governance-workspace-binding.controller';
import { GovernanceWorkspaceBindingService } from './services/governance-workspace-binding.service';
import { WorkspaceGovernanceEventHandler } from './integration/workspace-governance-event.handler';
import { GovernanceSourceVersionService } from './services/governance-source-version.service';
import { GovernanceSourceTransitionService } from './services/governance-source-transition.service';
import { GovernanceSourceEventService } from './services/governance-source-event.service';
import { GovernancePublicationAttempt, GovernancePublicationAttemptSchema } from './schemas/governance-publication-attempt.schema';
import { Agent, AgentSchema } from '@modules/agent/schemas/agent.schema';
import { IntegrationEventsModule } from '@modules/integration-events/integration-events.module';
import { WorkspaceDoc, WorkspaceDocumentSchema } from '@modules/workspace/schemas/workspace-document.schema';
import { Workspace, WorkspaceSchema } from '@modules/workspace/schemas/workspace.schema';
import { WorkspaceShare, WorkspaceShareSchema } from '@modules/workspace/schemas/workspace-share.schema';
import { GovernanceWorkspaceReconciliationService } from './services/governance-workspace-reconciliation.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GovernanceProgram.name, schema: GovernanceProgramSchema },
      { name: GovernanceScope.name, schema: GovernanceScopeSchema },
      { name: GovernanceSource.name, schema: GovernanceSourceSchema },
      { name: GovernanceSourceVersion.name, schema: GovernanceSourceVersionSchema },
      { name: GovernanceSourceEvent.name, schema: GovernanceSourceEventSchema },
      { name: GovernanceWorkspaceBinding.name, schema: GovernanceWorkspaceBindingSchema },
      { name: GovernanceMembership.name, schema: GovernanceMembershipSchema },
      { name: GovernanceDeployment.name, schema: GovernanceDeploymentSchema },
      { name: GovernanceDeploymentRevision.name, schema: GovernanceDeploymentRevisionSchema },
      { name: GovernanceDryRun.name, schema: GovernanceDryRunSchema },
      { name: GovernanceMetric.name, schema: GovernanceMetricSchema },
      { name: GovernancePublicationAttempt.name, schema: GovernancePublicationAttemptSchema },
      { name: Agent.name, schema: AgentSchema },
      { name: WorkspaceDoc.name, schema: WorkspaceDocumentSchema },
      { name: Workspace.name, schema: WorkspaceSchema },
      { name: WorkspaceShare.name, schema: WorkspaceShareSchema },
    ]),
    AuthorizationModule,
    ConversationModule,
    WidgetChatModule,
    WhatsAppModule,
    TelegramModule,
    UserGroupModule,
    LoggerModule,
    IntegrationEventsModule,
  ],
  controllers: [GovernanceProgramController, GovernanceScopeController, GovernanceSourceController, GovernanceWorkspaceBindingController, GovernanceMembershipController, GovernanceDeploymentController, GovernanceDryRunController, GovernanceMetricController],
  providers: [GovernanceProgramService, GovernanceScopeService, GovernanceScopeOverviewService, GovernanceSourceService, GovernanceSourceVersionService, GovernanceSourceTransitionService, GovernanceSourceEventService, GovernanceWorkspaceBindingService, GovernanceWorkspaceReconciliationService, WorkspaceGovernanceEventHandler, GovernanceMembershipService, GovernanceAccessService, GovernanceDeploymentService, GovernanceDryRunService, GovernanceMetricService, GovernanceChannelReadinessService],
  exports: [GovernanceProgramService, GovernanceScopeService, GovernanceSourceService, GovernanceAccessService, GovernanceMetricService],
})
export class GovernanceModule {}
