import {
  Controller,
  HttpCode,
  HttpStatus,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { MessageService } from '../services/message.service';
import { StreamService } from '../services/stream.service';
import { ConversationService } from '../services/conversation.service';
import { ModelsService } from '../../models/models.service';
import { TeamService } from '../../team/team.service';
import { SendMessageDto } from '../dto/send-message.dto';
import { MessageQueryDto } from '../dto/message-query.dto';
import { MessageFeedbackDto } from '../dto/message-feedback.dto';
import { UpdateMessageDto } from '../dto/update-message.dto';
import { ReportFrontendLatencyDto } from '../dto/report-frontend-latency.dto';
import { ConversationOwnerGuard } from '../guards/conversation-owner.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ServiceUnavailableException, BadRequestException, NotFoundException, ForbiddenException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { CheckUsage } from '../../usage/decorators/check-usage.decorator';
import { UsageLimitGuard } from '../../usage/guards/usage-limit.guard';
import { RequestContextService } from '../../request-context';
import { LoggerService } from '../../logger';
import { UserDocument } from '../../user/schemas/user.schema';
import { resolveStickyAgentRouting } from '../utils/sticky-agent-routing';
import { ChoiceInteractionService } from '../services/choice-interaction.service';
import { GovernedConversationRuntimeService } from '../../governance/services/governed-conversation-runtime.service';
import { ResponseReliabilityService } from '../services/response-reliability.service';
import { SemanticModelService } from '../../semantic-model/services/semantic-model.service';
import { createHash } from 'node:crypto';
import { ConflictException } from '../../exceptions';
import { PLATFORM_COPILOT } from '../../agent/constants/platform-copilot.constants';
import { ConversationArtifactService } from '../services/conversation-artifact.service';
import { ResolveCitationUrlDto } from '../dto/resolve-citation-url.dto';
import { ConversationPlaybookHandoffService } from '../services/conversation-playbook-handoff.service';
import { isMessageRequestIdentityConflict } from '../utils/postgres-error';
import type { ConversationLatencyStartContext } from '../interfaces/latency.interface';
import {
  activateBackendPreAdkTracker,
  beginBackendPreAdkStage,
  endBackendPreAdkStage,
} from '../utils/backend-latency-tracker';
import { ConversationSettingsService } from '../../system/conversation-settings.service';

/**
 * Surfacing a concurrently fetched read at its decision point: rejections are
 * re-thrown in the original sequential decision order, so parallel prefetching
 * never changes which error a request observes.
 */
function unwrapSettled<T>(result: PromiseSettledResult<T>): T {
  if (result.status === 'rejected') throw result.reason;
  return result.value;
}

@ApiTags('Messages')
@Controller('conversations/:conversationId/messages')
@ApiBearerAuth()
@UseGuards(ConversationOwnerGuard)
export class MessageController {
  constructor(
    private readonly messageService: MessageService,
    private readonly streamService: StreamService,
    private readonly conversationService: ConversationService,
    private readonly modelsService: ModelsService,
    private readonly teamService: TeamService,
    private readonly requestContext: RequestContextService,
    private readonly logger: LoggerService,
    private readonly choiceInteractionService: ChoiceInteractionService,
    private readonly governedRuntimeService: GovernedConversationRuntimeService,
    private readonly responseReliabilityService: ResponseReliabilityService,
    private readonly semanticModelService: SemanticModelService,
    private readonly conversationArtifactService: ConversationArtifactService,
    private readonly playbookHandoffService: ConversationPlaybookHandoffService,
    private readonly conversationSettings: ConversationSettingsService,
  ) {
    this.logger.setContext('MessageController');
  }

  @Post(':messageId/artifacts/:artifactId/url')
  async getArtifactDownloadUrl(
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Param('artifactId') artifactId: string,
  ): Promise<{ viewUrl: string; downloadUrl: string }> {
    return this.conversationArtifactService.resolveDownloadUrl(conversationId, messageId, artifactId);
  }

  @Post(':messageId/citations/url')
  async getCitationUrl(
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Body() dto: ResolveCitationUrlDto,
  ): Promise<{ url: string; fileName: string; mimeType: string }> {
    return this.conversationArtifactService.resolveCitationUrl(conversationId, messageId, dto);
  }

  /**
   * Merge directly-mentioned agents with the agents of any mentioned teams,
   * deduped. Returns undefined when nothing is mentioned, so downstream behaviour
   * is identical to a plain agent mention with no teams.
   */
  private async resolveAgentIds(
    userId: string,
    agentIds?: string[],
    teamIds?: string[],
  ): Promise<string[] | undefined> {
    const merged = new Set<string>(agentIds || []);
    if (teamIds?.length) {
      const teamAgentIds = await this.teamService.resolveAgentIds(teamIds, userId);
      teamAgentIds.forEach((id) => merged.add(id));
    }
    return merged.size > 0 ? [...merged] : undefined;
  }

  /**
   * Human-readable display name for logs/observability: "First Last" when a
   * profile name is set, otherwise falls back to the user's email.
   */
  private resolveDisplayName(user: UserDocument): string {
    const fullName = `${user.profile?.firstName ?? ''} ${user.profile?.lastName ?? ''}`.trim();
    return fullName || user.email;
  }

  @Post()
  @UseGuards(UsageLimitGuard)
  @CheckUsage()
  async sendMessage(
    @CurrentUser() user: UserDocument,
    @Param('conversationId') conversationId: string,
    @Body() dto: SendMessageDto,
  ) {
    // Latency instrumentation boundary: must be the first application code the
    // request reaches, before fingerprinting, lookups, or log payload building.
    const backendReceivedEpochMs = Date.now();
    const backendReceivedMonoNs = process.hrtime.bigint();
    // Diagnostic backend pre-ADK breakdown. Gated by the cached admin switch
    // (sync read) so request entry never blocks on settings DB I/O.
    activateBackendPreAdkTracker(this.conversationSettings.isLatencyInstrumentationEnabledCached());
    beginBackendPreAdkStage('controllerValidationRoutingMs');
    const requestId = dto.requestId ?? this.requestContext.getRequestId();
    const requestFingerprint = this.fingerprintTurn(dto);

    this.logger.log('Request received', {
      conversationId,
      contentLength: dto.content.length,
      hasFiles: !!dto.attachedFileIds?.length,
      fileCount: dto.attachedFileIds?.length || 0,
      webSearchEnabled: dto.webSearchEnabled,
      deepSearchEnabled: dto.deepSearchEnabled,
      modelId: dto.modelId,
      agentIds: dto.agentIds,
    });

    const conversation = await this.conversationService.getConversationDocument(conversationId);
    const platformCopilot = conversation.runtimePurpose === PLATFORM_COPILOT;
    if (platformCopilot) {
      const hasRuntimeOverride = [
        dto.agentIds,
        dto.teamIds,
        dto.memberIds,
        dto.modelId,
        dto.semanticModelId,
        dto.reasoningEffort,
        dto.skillIds,
        dto.connectorRepo,
      ].some((value) => value !== undefined);
      if (hasRuntimeOverride) {
        throw new ForbiddenException(
          ErrorCode.CHAT_FORBIDDEN,
          'Platform copilot routing and capabilities cannot be overridden by the client',
        );
      }
      await this.conversationService.resolvePlatformCopilotAgent(conversation);
    } else if (dto.playbookHandoffId) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Playbook handoffs require a Platform Copilot conversation');
    }

    // Phase 5 pre-agent reduction: the read-only lookups below depend only on
    // the already-loaded conversation and the DTO — fetch them concurrently,
    // then apply the original decisions in the original order so error
    // precedence stays deterministic.
    const governedConversation = conversation.runtimeMode === 'governed'
      ? {
          runtimeMode: conversation.runtimeMode,
          createdBy: conversation.createdBy.toString(),
          governanceContext: conversation.governanceContext
            ? {
                programId: conversation.governanceContext.programId.toString(),
                scopeId: conversation.governanceContext.scopeId.toString(),
                deploymentId: conversation.governanceContext.deploymentId.toString(),
                revisionId: conversation.governanceContext.revisionId.toString(),
                revisionNumber: conversation.governanceContext.revisionNumber,
                runtimeDefinition: conversation.governanceContext.runtimeDefinition,
              }
            : undefined,
        }
      : undefined;
    const settle = <T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> =>
      promise.then(
        (value): PromiseSettledResult<T> => ({ status: 'fulfilled', value }),
        (reason: unknown): PromiseSettledResult<T> => ({ status: 'rejected', reason }),
      );
    const [existingTurnSettled, governedRuntimeSettled, modelValidationSettled, mentionedAgentsSettled, reasoningModelSettled] = await Promise.all([
      settle(dto.requestId
        ? this.messageService.findTurnByRequestId(conversationId, user._id.toString(), dto.requestId)
        : Promise.resolve(undefined)),
      settle(governedConversation
        ? this.governedRuntimeService.resolveRuntime(user._id.toString(), governedConversation)
        : Promise.resolve(undefined)),
      settle(!governedConversation && !platformCopilot && dto.modelId
        ? this.modelsService.validateModelActive(dto.modelId, 'chat')
        : Promise.resolve(undefined)),
      settle(!platformCopilot
        ? this.resolveAgentIds(user._id.toString(), dto.agentIds, dto.teamIds)
        : Promise.resolve(undefined)),
      settle(dto.reasoningEffort && dto.modelId && !platformCopilot
        ? this.modelsService.findById(dto.modelId)
        : Promise.resolve(undefined)),
    ]);

    if (dto.requestId) {
      const existingTurn = unwrapSettled(existingTurnSettled);
      if (existingTurn) {
        if (existingTurn.requestFingerprint !== requestFingerprint) {
          throw new ConflictException(
            ErrorCode.IDEMPOTENCY_MISMATCH,
            'The request body does not match the idempotent message turn',
          );
        }
        if (platformCopilot) {
          await this.recoverPlaybookHandoff(dto, user._id.toString(), conversationId, existingTurn.userMessage.id);
          return this.resumePlatformCopilotTurn(
            user,
            conversationId,
            conversation.pinnedAgentId!.toString(),
            dto,
            existingTurn,
          );
        }
        return { userMessage: existingTurn.userMessage, aiMessageId: existingTurn.aiMessageId };
      }
    }

    // If files attached, ensure system workspace exists
    if (dto.attachedFileIds?.length) {
      await this.conversationService.ensureSystemWorkspace(
        user._id.toString(),
        conversationId,
      );
    }

    const governedRuntime = unwrapSettled(governedRuntimeSettled);
    if (governedRuntime) this.governedRuntimeService.assertRuntimeRequestAllowed(governedRuntime, dto);
    if (!governedRuntime && dto.semanticModelId) {
      await this.semanticModelService.resolveSearchSchema(user._id.toString(), dto.semanticModelId);
    }
    const effectiveSemanticModelId = governedRuntime ? undefined : dto.semanticModelId;

    // Validate model is active for standard conversations only.
    if (!governedRuntime && !platformCopilot && dto.modelId) {
      const modelValidation = unwrapSettled(modelValidationSettled);
      if (!modelValidation) {
        throw new NotFoundException(ErrorCode.MODEL_NOT_FOUND);
      }
      if (!modelValidation.valid) {
        if (modelValidation.inactive) {
          this.logger.warn('Attempted to use inactive model', {
            conversationId,
            modelId: dto.modelId,
          });
          throw new BadRequestException(ErrorCode.MODEL_INACTIVE);
        } else if (modelValidation.unsupported) {
          this.logger.warn('Attempted to use a non-chat model for conversation', {
            conversationId,
            modelId: dto.modelId,
          });
          throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Selected model does not support chat.');
        } else {
          this.logger.warn('Attempted to use unknown model', {
            conversationId,
            modelId: dto.modelId,
          });
          throw new NotFoundException(ErrorCode.MODEL_NOT_FOUND);
        }
      }
    }

    // Fail fast if AI service is unavailable
    if (!this.streamService.isAvailable()) {
      this.logger.warn('AI service unavailable', { conversationId });
      throw new ServiceUnavailableException(
        ErrorCode.CHAT_GRPC_UNAVAILABLE,
        'AI service is currently unavailable',
      );
    }

    // Check if this is the first message (for name generation)
    const isFirstMessage = conversation.isFirstMessage;

    // Mark as not first message anymore (do this before creating message to avoid race conditions)
    if (isFirstMessage) {
      await this.conversationService.updateConversationInternal(conversationId, {
        isFirstMessage: false,
      });
    }

    this.logger.log('Validation complete, creating messages', {
      conversationId,
      isFirstMessage,
      senderId: user._id.toString(),
    });

    // Mentions replace sticky taggedAgentIds; untagged AI turns reuse them.
    // Member-only turns never reuse sticky (avoid stamping agents on human pings).
    const mentionedAgentIds = platformCopilot
      ? [conversation.pinnedAgentId!.toString()]
      : governedRuntime
      ? this.governedRuntimeService.resolveEffectiveAgents(governedRuntime, dto.agentIds)
      : (unwrapSettled(mentionedAgentsSettled)) ?? [];
    const stickyAgentIds =
      conversation.taggedAgentIds?.map((id) => id.toString()) ?? [];
    const willRunAi = !dto.memberIds?.length;
    const { effectiveAgentIds, shouldReplaceSticky } =
      resolveStickyAgentRouting({
        mentionedAgentIds,
        stickyAgentIds,
        reuseSticky: willRunAi,
      });

    let effectiveReasoningEffort: string | undefined;
    if (dto.reasoningEffort) {
      if (governedRuntime || platformCopilot || !willRunAi || (effectiveAgentIds?.length ?? 0) > 0) {
        throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Reasoning effort is available only for untagged standard model turns.');
      }
      if (!dto.modelId) {
        throw new BadRequestException(ErrorCode.BAD_REQUEST, 'A selected model is required when reasoning effort is provided.');
      }
      const selectedModel = unwrapSettled(reasoningModelSettled);
      if (!selectedModel?.isActive || selectedModel.supportsReasoning !== true || !selectedModel.reasoning.efforts.some((effort) => effort.id === dto.reasoningEffort)) {
        throw new BadRequestException(ErrorCode.BAD_REQUEST, 'The selected reasoning effort is not supported by this model.');
      }
      effectiveReasoningEffort = dto.reasoningEffort;
    }

    if (dto.playbookHandoffId) {
      if (!dto.requestId) throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Playbook handoff turns require a stable request ID');
      if (dto.interaction || dto.interactions?.length) throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Playbook handoffs require an explicit prompt turn');
      await this.playbookHandoffService.bind({
        handoffId: dto.playbookHandoffId,
        ownerId: user._id.toString(),
        platformConversationId: conversationId,
        turnRequestId: dto.requestId,
        prompt: dto.content,
      });
    }

    if (!platformCopilot && shouldReplaceSticky && effectiveAgentIds?.length) {
      await this.conversationService.replaceTaggedAgentIds(
        conversationId,
        effectiveAgentIds,
      );
    }

    let canonicalInteraction: Record<string, unknown> | undefined;
    let canonicalInteractions: Record<string, unknown>[] | undefined;
    let canonicalContent = dto.content;
    let canonicalTaskSummary: string | undefined;
    if (dto.interaction) {
      const canonicalChoice = await this.choiceInteractionService.canonicalize(conversationId, dto.interaction);
      canonicalInteraction = canonicalChoice.interaction;
      canonicalContent = canonicalChoice.content;
      canonicalTaskSummary = canonicalChoice.taskSummary;
    } else if (dto.interactions?.length) {
      const canonicalMulti = await this.choiceInteractionService.canonicalizeMany(conversationId, dto.interactions);
      canonicalInteractions = canonicalMulti.interactions;
      canonicalContent = canonicalMulti.content;
      canonicalTaskSummary = canonicalMulti.taskSummary;
    }

    // Controller validation/routing ends where user-message persistence starts.
    endBackendPreAdkStage('controllerValidationRoutingMs');
    beginBackendPreAdkStage('userMessagePersistenceMs');
    let userMessage: Awaited<ReturnType<MessageService['createUserMessage']>>;
    let aiPlaceholder: Awaited<ReturnType<MessageService['createAIPlaceholder']>> | undefined;
    try {
      // Fail fast before ANY persistence when we will need the AI service and
      // it is unavailable — a cold gRPC no longer leaves an orphan user
      // message claiming the request id.
      if (willRunAi && !this.streamService.isAvailable()) {
        this.logger.warn('AI service unavailable for response', { conversationId });
        throw new ServiceUnavailableException(
          ErrorCode.CHAT_GRPC_UNAVAILABLE,
          'AI service is currently unavailable',
        );
      }

      if (willRunAi) {
        // Single-transaction turn: user message + AI placeholder + linkage.
        const turn = await this.messageService.createUserMessageWithAiPlaceholder({
          conversationId,
          senderId: user._id.toString(),
          content: canonicalContent,
          attachedFileIds: dto.attachedFileIds,
          webSearchEnabled: dto.webSearchEnabled,
          modelId: dto.modelId,
          semanticModelId: effectiveSemanticModelId,
          reasoningEffort: effectiveReasoningEffort,
          agentIds: effectiveAgentIds,
          memberIds: dto.memberIds,
          requestId,
          parentMessageId: dto.parentMessageId,
          interaction: canonicalInteraction,
          interactions: canonicalInteractions,
          replayContext: {
            requestFingerprint,
            content: canonicalContent,
            taskSummary: canonicalTaskSummary,
            attachedFileIds: dto.attachedFileIds ?? [],
            webSearchEnabled: dto.webSearchEnabled ?? false,
            deepSearchEnabled: dto.deepSearchEnabled ?? false,
            modelId: dto.modelId,
            reasoningEffort: effectiveReasoningEffort,
            agentIds: effectiveAgentIds ?? [],
            skillIds: dto.skillIds ?? [],
            connectorRepo: dto.connectorRepo,
            clientContext: dto.clientContext,
            playbookHandoffId: dto.playbookHandoffId,
            governanceOverride: governedRuntime ? {
              runtimeMode: 'governed',
              primaryAgentId: governedRuntime.primaryAgentId,
              allowedAgentIds: governedRuntime.allowedAgentIds,
              workspaceIds: governedRuntime.workspaceIds,
              revisionId: governedRuntime.revisionId,
              scopeId: governedRuntime.scopeId,
            } : undefined,
          },
          placeholder: {
            conversationId,
            senderId: user._id.toString(),
            modelId: dto.modelId,
            reasoningEffort: effectiveReasoningEffort,
            requestId,
          },
        });
        userMessage = turn.userMessage;
        aiPlaceholder = turn.aiMessage;
      } else {
        userMessage = await this.messageService.createUserMessage({
          conversationId,
          senderId: user._id.toString(),
          content: canonicalContent,
          attachedFileIds: dto.attachedFileIds,
          webSearchEnabled: dto.webSearchEnabled,
          modelId: dto.modelId,
          reasoningEffort: effectiveReasoningEffort,
          agentIds: effectiveAgentIds,
          memberIds: dto.memberIds,
          requestId,
          parentMessageId: dto.parentMessageId,
          interaction: canonicalInteraction,
          interactions: canonicalInteractions,
          replayContext: {
            requestFingerprint,
            content: canonicalContent,
            taskSummary: canonicalTaskSummary,
            attachedFileIds: dto.attachedFileIds ?? [],
            webSearchEnabled: dto.webSearchEnabled ?? false,
            deepSearchEnabled: dto.deepSearchEnabled ?? false,
            modelId: dto.modelId,
            reasoningEffort: effectiveReasoningEffort,
            agentIds: effectiveAgentIds ?? [],
            skillIds: dto.skillIds ?? [],
            connectorRepo: dto.connectorRepo,
            clientContext: dto.clientContext,
            playbookHandoffId: dto.playbookHandoffId,
            governanceOverride: governedRuntime ? {
              runtimeMode: 'governed',
              primaryAgentId: governedRuntime.primaryAgentId,
              allowedAgentIds: governedRuntime.allowedAgentIds,
              workspaceIds: governedRuntime.workspaceIds,
              revisionId: governedRuntime.revisionId,
              scopeId: governedRuntime.scopeId,
            } : undefined,
          },
        });
      }
      endBackendPreAdkStage('userMessagePersistenceMs');
      // The placeholder now persists inside the same transaction; the stage
      // stays in the breakdown with its true (≈0) cost.
      beginBackendPreAdkStage('aiPlaceholderPersistenceMs');
      endBackendPreAdkStage('aiPlaceholderPersistenceMs');
      if (dto.playbookHandoffId) {
        await this.playbookHandoffService.attachUserMessage(dto.playbookHandoffId, user._id.toString(), userMessage.id);
      }
    } catch (error: unknown) {
      if (dto.requestId && isMessageRequestIdentityConflict(error)) {
        const racedTurn = await this.messageService.findTurnByRequestId(conversationId, user._id.toString(), dto.requestId);
        if (racedTurn?.requestFingerprint === requestFingerprint) {
          if (platformCopilot) {
            await this.recoverPlaybookHandoff(dto, user._id.toString(), conversationId, racedTurn.userMessage.id);
            return this.resumePlatformCopilotTurn(
              user,
              conversationId,
              conversation.pinnedAgentId!.toString(),
              dto,
              racedTurn,
            );
          }
          return { userMessage: racedTurn.userMessage, aiMessageId: racedTurn.aiMessageId };
        }
      }
      throw error;
    }

    // Fire and forget - generate conversation name asynchronously on first message
    if (isFirstMessage) {
      this.streamService.generateConversationNameAsync(
        user._id.toString(),
        conversationId,
        canonicalContent,
        user.email,
      );
    }

    let aiMessageId: string | undefined;

    // Start stream — the placeholder was persisted with the user message in
    // the single turn transaction (fail-fast for AI availability ran before
    // persistence), so the placeholder's presence marks an AI turn.
    if (aiPlaceholder) {
      const aiMessage = aiPlaceholder;
      aiMessageId = aiMessage.id;

      const latencyStart: ConversationLatencyStartContext = {
        schemaVersion: 1,
        requestId,
        assistantMessageId: aiMessage.id,
        backendReceivedEpochMs,
        backendReceivedMonoNs,
      };

      this.logger.log('Starting stream', {
        conversationId,
        userMessageId: userMessage.id,
        aiMessageId: aiMessage.id,
        connectorId: dto.connectorRepo?.connectorId,
        connectorRepoName: dto.connectorRepo?.repoName,
      });

      // Start streaming (non-blocking)
      this.streamService
        .startStream(user._id.toString(), conversationId, aiMessage.id, {
          content: canonicalContent,
          taskSummary: canonicalTaskSummary,
          attachedFileIds: dto.attachedFileIds,
          webSearchEnabled: dto.webSearchEnabled,
          deepSearchEnabled: dto.deepSearchEnabled,
          modelId: dto.modelId,
          semanticModelId: effectiveSemanticModelId,
          reasoningEffort: effectiveReasoningEffort,
          agentIds: effectiveAgentIds,
          connectorRepo: dto.connectorRepo,
          skillIds: dto.skillIds,
          clientContext: dto.clientContext,
          playbookHandoffId: dto.playbookHandoffId,
        }, requestId, undefined, this.resolveDisplayName(user), governedRuntime ? {
          runtimeMode: 'governed',
          primaryAgentId: governedRuntime.primaryAgentId,
          allowedAgentIds: governedRuntime.allowedAgentIds,
          workspaceIds: governedRuntime.workspaceIds,
          revisionId: governedRuntime.revisionId,
          scopeId: governedRuntime.scopeId,
        } : undefined, latencyStart)
        .catch((err) => {
          if ((err as { code?: ErrorCode }).code === ErrorCode.CHAT_ALREADY_STREAMING) return;
          this.logger.error('Stream start failed', {
            conversationId,
            aiMessageId: aiMessage.id,
            error: (err as Error).message,
          });
        });
    } else {
      this.logger.log('Skipping AI response due to member tags', {
        conversationId,
        memberTagCount: dto.memberIds?.length ?? 0,
      });
    }

    return { userMessage, aiMessageId };
  }

  private async resumePlatformCopilotTurn(
    user: UserDocument,
    conversationId: string,
    pinnedAgentId: string,
    dto: SendMessageDto,
    turn: NonNullable<Awaited<ReturnType<MessageService['findTurnByRequestId']>>>,
  ) {
    if (!turn) throw new ConflictException(ErrorCode.CONFLICT, 'The platform copilot turn could not be recovered');
    if (!this.streamService.isAvailable()) {
      throw new ServiceUnavailableException(
        ErrorCode.CHAT_GRPC_UNAVAILABLE,
        'AI service is currently unavailable',
      );
    }
    let aiMessageId = turn.aiMessageId;
    let shouldStart = false;
    if (!aiMessageId) {
      try {
        const placeholder = await this.messageService.createAIPlaceholder({
          conversationId,
          questionMessageId: turn.userMessage.id,
          senderId: user._id.toString(),
          requestId: dto.requestId,
        });
        aiMessageId = placeholder.id;
        shouldStart = true;
      } catch (error: unknown) {
        if (typeof error !== 'object' || error === null || !('code' in error) || (error as { code?: number }).code !== 11000) {
          throw error;
        }
        const racedTurn = await this.messageService.findTurnByRequestId(
          conversationId,
          user._id.toString(),
          dto.requestId!,
        );
        aiMessageId = racedTurn?.aiMessageId;
      }
    }
    if (!aiMessageId) {
      throw new ConflictException(ErrorCode.CONFLICT, 'The platform copilot response could not be recovered');
    }
    if (!shouldStart) {
      const response = await this.messageService.getMessageDocument(aiMessageId);
      shouldStart = response.isComplete !== true;
    }
    if (shouldStart && !this.streamService.isConversationStreaming(user._id.toString(), conversationId)) {
      this.streamService.startStream(user._id.toString(), conversationId, aiMessageId, {
        content: turn.userMessage.content ?? dto.content,
        attachedFileIds: dto.attachedFileIds,
        webSearchEnabled: dto.webSearchEnabled,
        deepSearchEnabled: dto.deepSearchEnabled,
        agentIds: [pinnedAgentId],
        clientContext: dto.clientContext,
        playbookHandoffId: dto.playbookHandoffId,
      }, dto.requestId, undefined, this.resolveDisplayName(user), undefined, {
        schemaVersion: 1,
        requestId: dto.requestId ?? this.requestContext.getRequestId(),
        assistantMessageId: aiMessageId,
        backendReceivedEpochMs: Date.now(),
      }).catch((error: unknown) => {
        if ((error as { code?: ErrorCode }).code === ErrorCode.CHAT_ALREADY_STREAMING) return;
        this.logger.error('Recovered stream start failed', {
          conversationId,
          aiMessageId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    return { userMessage: turn.userMessage, aiMessageId };
  }

  private async recoverPlaybookHandoff(
    dto: SendMessageDto,
    ownerId: string,
    conversationId: string,
    userMessageId: string,
  ): Promise<void> {
    if (!dto.playbookHandoffId) return;
    if (!dto.requestId) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Playbook handoff turns require a stable request ID');
    }
    await this.playbookHandoffService.bind({
      handoffId: dto.playbookHandoffId,
      ownerId,
      platformConversationId: conversationId,
      turnRequestId: dto.requestId,
      prompt: dto.content,
    });
    await this.playbookHandoffService.attachUserMessage(dto.playbookHandoffId, ownerId, userMessageId);
  }

  private fingerprintTurn(dto: SendMessageDto): string {
    const canonical = {
      content: dto.content,
      attachedFileIds: dto.attachedFileIds ?? [],
      webSearchEnabled: dto.webSearchEnabled ?? false,
      deepSearchEnabled: dto.deepSearchEnabled ?? false,
      modelId: dto.modelId ?? null,
      semanticModelId: dto.semanticModelId ?? null,
      reasoningEffort: dto.reasoningEffort ?? null,
      agentIds: dto.agentIds ?? [],
      memberIds: dto.memberIds ?? [],
      teamIds: dto.teamIds ?? [],
      parentMessageId: dto.parentMessageId ?? null,
      connectorRepo: dto.connectorRepo ?? null,
      skillIds: dto.skillIds ?? [],
      interaction: dto.interaction ?? null,
      interactions: dto.interactions ?? null,
      clientContext: dto.clientContext ?? null,
      playbookHandoffId: dto.playbookHandoffId ?? null,
    };
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  @Get()
  async findAll(
    @Param('conversationId') conversationId: string,
    @Query() query: MessageQueryDto,
  ) {
    return this.messageService.findByConversation(conversationId, query);
  }

  @Get(':messageId')
  async findOne(@Param('messageId') messageId: string) {
    return this.messageService.findById(messageId);
  }

  /** On-demand payload for one tool activity; message responses omit tool results. */
  @Get(':messageId/tools/:componentId/result')
  async getToolActivityResult(
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Param('componentId') componentId: string,
  ): Promise<{ resultJson: string | null }> {
    return this.messageService.findToolActivityResult(conversationId, messageId, componentId);
  }

  @Patch(':messageId/feedback')
  async updateFeedback(
    @Param('messageId') messageId: string,
    @Body() dto: MessageFeedbackDto,
  ) {
    return this.messageService.updateFeedback(messageId, dto.feedback);
  }

  /**
   * Idempotent report of the browser-measured sixth latency metric. Called
   * after stream_complete so it never competes with the first-token window.
   */
  @Post(':messageId/latency/frontend-paint')
  async reportFrontendLatency(
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Body() dto: ReportFrontendLatencyDto,
  ) {
    return this.messageService.reportFrontendLatency(
      conversationId,
      messageId,
      dto.requestId,
      {
        frontendFirstChunkPaintedEpochMs: dto.frontendFirstChunkPaintedEpochMs,
        frontendRenderMs: dto.frontendRenderMs,
        browserRenderOnlyMs: dto.browserRenderOnlyMs,
        quality: dto.quality,
        clientMetrics: dto.clientMetrics,
      },
    );
  }

  @Patch(':messageId')
  async updateMessage(
    @Param('messageId') messageId: string,
    @Body() dto: UpdateMessageDto,
  ) {
    return this.messageService.updateUserMessage(messageId, dto.content, dto.agentIds, dto.memberIds);
  }

  @Get(':messageId/branches')
  async getBranches(@Param('messageId') messageId: string) {
    return this.messageService.findBranchesByQuestion(messageId);
  }

  @Post(':messageId/stop')
  async stopStream(
    @CurrentUser() user: UserDocument,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
  ) {
    this.logger.log('Stop stream request received', {
      conversationId,
      messageId,
    });

    await this.streamService.stopStream(user._id.toString(), conversationId, messageId);

    this.logger.log('Stream stopped successfully', {
      conversationId,
      messageId,
    });

    return { stopped: true };
  }

  @Post(':messageId/reliability-evaluation/rerun')
  @HttpCode(HttpStatus.ACCEPTED)
  async rerunReliabilityEvaluation(
    @CurrentUser() user: UserDocument,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.responseReliabilityService.rerun({
      conversationId,
      messageId,
      userId: user._id.toString(),
      requestId: this.requestContext.getRequestId(),
    });
  }

  @Post(':messageId/regenerate')
  @UseGuards(UsageLimitGuard)
  @CheckUsage()
  async regenerate(
    @CurrentUser() user: UserDocument,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
  ) {
    // Regenerated answers are new generations with their own latency trace.
    const backendReceivedEpochMs = Date.now();
    const requestId = this.requestContext.getRequestId();

    this.logger.log('Regenerate request received', {
      conversationId,
      messageId,
    });

    // Fail fast if AI service is unavailable
    if (!this.streamService.isAvailable()) {
      this.logger.warn('AI service unavailable for regenerate', { conversationId, messageId });
      throw new ServiceUnavailableException(
        ErrorCode.CHAT_GRPC_UNAVAILABLE,
        'AI service is currently unavailable',
      );
    }

    // Get the original user message that prompted this AI response
    const aiMessage = await this.messageService.getMessageDocument(messageId);
    const questionId = aiMessage.questionMessageId?.toString();

    if (!questionId) {
      this.logger.warn('No question message found for regenerate', { messageId });
      return this.messageService.findById(messageId);
    }

    const userMessage = await this.messageService.getMessageDocument(questionId);
    const conversation = await this.conversationService.getConversationDocument(conversationId);
    const platformCopilot = conversation.runtimePurpose === PLATFORM_COPILOT;
    const pinnedAgentId = platformCopilot
      ? await this.conversationService.resolvePlatformCopilotAgent(conversation)
      : undefined;

    // Create new AI placeholder
    const newAiMessage = await this.messageService.createAIPlaceholder({
      conversationId,
      questionMessageId: questionId,
      senderId: user._id.toString(),
      modelId: userMessage.modelId,
      reasoningEffort: userMessage.reasoningEffort,
      requestId,
    });

    this.logger.log('Starting regenerate stream', {
      conversationId,
      originalMessageId: messageId,
      newAiMessageId: newAiMessage.id,
    });

    const currentContent = userMessage.content || '';
    const replayContentMatches = userMessage.replayContext?.content === currentContent;

    // Start streaming (non-blocking)
    this.streamService
      .startStream(
        user._id.toString(),
        conversationId,
        newAiMessage.id,
        userMessage.replayContext ? {
          ...userMessage.replayContext,
          content: currentContent,
          ...(!replayContentMatches ? { taskSummary: undefined } : {}),
          modelId: userMessage.modelId,
          reasoningEffort: userMessage.reasoningEffort,
          agentIds: userMessage.agentIds?.map((id) => id.toString()) ?? [],
          ...(pinnedAgentId ? {
            agentIds: [pinnedAgentId],
            modelId: undefined,
            skillIds: [],
            connectorRepo: undefined,
          } : {}),
        } : {
          content: currentContent,
          attachedFileIds: userMessage.attachedFileIds?.map((id) => id.toString()) ?? [],
          webSearchEnabled: userMessage.webSearchEnabled,
          deepSearchEnabled: false,
          modelId: userMessage.modelId,
          reasoningEffort: userMessage.reasoningEffort,
          agentIds: pinnedAgentId ? [pinnedAgentId] : userMessage.agentIds?.map((id) => id.toString()) ?? [],
          skillIds: [],
        },
        requestId,
        undefined,
        this.resolveDisplayName(user),
        userMessage.replayContext?.governanceOverride,
        {
          schemaVersion: 1,
          requestId,
          assistantMessageId: newAiMessage.id,
          backendReceivedEpochMs,
        },
      )
      .catch((err) => {
        this.logger.error('Regenerate stream failed', {
          conversationId,
          newAiMessageId: newAiMessage.id,
          error: (err as Error).message,
        });
        this.messageService.markStreamFailed(newAiMessage.id);
      });

    return { aiMessage: await this.messageService.findById(newAiMessage.id) };
  }
}
