import { ConversationRootResolverService } from './root-work/conversation-root-resolver.service';
import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

// Controllers
import { ConversationController } from './controllers/conversation.controller';
import { MessageController } from './controllers/message.controller';
import { StreamController } from './controllers/stream.controller';
import { ShareController } from './controllers/share.controller';
import { ReportController } from './controllers/report.controller';
import { ConversationFileController } from './controllers/conversation-file.controller';
import { ComposerSuggestionsController } from './controllers/composer-suggestions.controller';

// Services
import { ConversationService } from './services/conversation.service';
import { MessageService } from './services/message.service';
import { StreamService } from './services/stream.service';
import { StreamGatewayService } from './services/stream-gateway.service';
import { ConversationRecoveryService } from './services/conversation-recovery.service';
import { ShareService } from './services/share.service';
import { ReportService } from './services/report.service';
import { ComposerSuggestionsService } from './services/composer-suggestions.service';
import { ChoiceInteractionService } from './services/choice-interaction.service';
import { ConversationBranchService } from './services/conversation-branch.service';
import { ConversationPlaybookContextProjectorService } from './services/conversation-playbook-context-projector.service';
import { ConversationPlaybookHandoffService } from './services/conversation-playbook-handoff.service';

// Guards
import { ConversationOwnerGuard } from './guards/conversation-owner.guard';
import { SseAuthGuard } from './guards/stream-auth.guard';
import { ComposerSuggestionsRateLimitGuard } from './guards/composer-suggestions-rate-limit.guard';

// External modules
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ModelsModule } from '../models/models.module';
import { LoggerModule } from '../logger';
import { UsageModule } from '../usage';
import { AgentModule } from '../agent/agent.module';
import { TeamModule } from '../team/team.module';
import { AgentTypeModule } from '../agent-type/agent-type.module';
import { SkillModule } from '../skill/skill.module';
import { EmailModule } from '../email/email.module';
import conversationConfig from '../../config/conversation.config';
import { GovernanceRuntimeModule } from '../governance/governance-runtime.module';
import { IndexingModule } from '../indexing/indexing.module';
import { EvaluationModule } from '../evaluation/evaluation.module';
import { ResponseReliabilityService } from './services/response-reliability.service';
import { ResponseReliabilityEvidenceBuilder } from './services/response-reliability-evidence.builder';
import { ResponseReliabilityScoringService } from './services/response-reliability-scoring.service';
import { ResponseCorrectionPolicyService } from './services/response-correction-policy.service';
import { ResponseCorrectionPlannerService } from './services/response-correction-planner.service';
import { CorrectedResponseComponentBuilder } from './services/corrected-response-component.builder';
import { ResponseCorrectionService } from './services/response-correction.service';
import { ConversationAgentRequestBuilder } from './services/conversation-agent-request.builder';
import { ConversationAttachmentResolverService } from './services/conversation-attachment-resolver.service';
import { ConversationAttachmentService } from './services/conversation-attachment.service';
import { ConversationAttachmentContextService } from './services/conversation-attachment-context.service';
import { RootWorkService } from './root-work/root-work.service';
import { RootDelegateDefinitionService } from './root-work/root-delegate-definition.service';
import { RootDelegateInternalController } from './controllers/root-delegate-internal.controller';
import { RootInputController } from './controllers/root-input.controller';
import { RootWorkPublicController } from './controllers/root-work-public.controller';
import { RootWorkPublicService } from './root-work/root-work-public.service';
import { RootInputService } from './root-work/root-input.service';
import { RootResultController } from './controllers/root-result.controller';
import { RootResultService } from './root-work/root-result.service';
import { RootEvidenceService } from './root-work/root-evidence.service';
import { RootTemporaryDefinitionService } from './root-work/root-temporary-definition.service';
import { RootFanoutService } from './root-work/root-fanout.service';
import { RootBackgroundJobStore } from './persistence/postgres/root-background-job.store';
import { RootBackgroundEventStore } from './persistence/postgres/root-background-event.store';
import { RootBackgroundLifecycleService } from './root-work/root-background-lifecycle.service';
import { RootBackgroundDriverService } from './root-work/root-background-driver.service';
import { RootFollowupService } from './root-work/root-followup.service';
import { RootFollowupStore } from './persistence/postgres/root-followup.store';
import { RootBackgroundSubmissionService } from './root-work/root-background-submission.service';
import { RootBackgroundInputService } from './root-work/root-background-input.service';
import { CorrectiveReplayContextService } from './services/corrective-replay-context.service';
import { CorrectiveReplayPromptBuilder } from './services/corrective-replay-prompt.builder';
import { CorrectiveReplayRunnerService } from './services/corrective-replay-runner.service';
import { SemanticModelModule } from '../semantic-model/semantic-model.module';
import { ConversationArtifactService } from './services/conversation-artifact.service';
import { UserModule } from '../user/user.module';
import { ConversationPersistenceModule } from './persistence/conversation-persistence.module';
import { ProjectModule } from '../project/project.module';
import { ModelPricingService } from './services/model-pricing.service';
import { CarbonEstimatorService } from './services/carbon-estimator.service';
import { ConversationUsageAccountingService } from './services/conversation-usage-accounting.service';
import { ConversationNameService } from './services/conversation-name.service';

@Module({
  imports: [ConfigModule.forFeature(conversationConfig), ConversationPersistenceModule, JwtModule.register({}), forwardRef(() => AuthModule), forwardRef(() => AuthorizationModule), forwardRef(() => WorkspaceModule), forwardRef(() => IndexingModule), ModelsModule, LoggerModule, UsageModule, forwardRef(() => AgentModule), TeamModule, AgentTypeModule, SkillModule, EmailModule, GovernanceRuntimeModule, forwardRef(() => EvaluationModule), UserModule, SemanticModelModule, ProjectModule],
  controllers: [
    RootInputController,
    RootWorkPublicController,
    RootResultController,
    RootDelegateInternalController,
    StreamController, // Must be before ConversationController to avoid route conflict with :id param
    ComposerSuggestionsController,
    ConversationController,
    MessageController,
    ShareController,
    ReportController,
    ConversationFileController,
  ],
  providers: [ConversationRootResolverService, RootFollowupService, RootFollowupStore, RootWorkPublicService, ConversationService, MessageService, StreamService, StreamGatewayService, ConversationNameService, ConversationRecoveryService, ShareService, ReportService, ComposerSuggestionsService, ChoiceInteractionService, ConversationBranchService, ConversationPlaybookContextProjectorService, ConversationPlaybookHandoffService, ResponseReliabilityService, ResponseReliabilityEvidenceBuilder, ResponseReliabilityScoringService, ResponseCorrectionPolicyService, ResponseCorrectionPlannerService, CorrectedResponseComponentBuilder, ResponseCorrectionService, ConversationAgentRequestBuilder, ConversationAttachmentResolverService, ConversationAttachmentService, ConversationAttachmentContextService, CorrectiveReplayContextService, CorrectiveReplayPromptBuilder, CorrectiveReplayRunnerService, ConversationArtifactService, ModelPricingService, CarbonEstimatorService, ConversationUsageAccountingService, ConversationOwnerGuard, SseAuthGuard, ComposerSuggestionsRateLimitGuard, RootWorkService, RootDelegateDefinitionService, RootInputService, RootResultService, RootEvidenceService, RootTemporaryDefinitionService, RootFanoutService, RootBackgroundJobStore, RootBackgroundEventStore, RootBackgroundLifecycleService, RootBackgroundDriverService, RootBackgroundSubmissionService, RootBackgroundInputService],
  exports: [ConversationService, MessageService, StreamService, StreamGatewayService, ConversationPlaybookHandoffService],
})
export class ConversationModule {}
