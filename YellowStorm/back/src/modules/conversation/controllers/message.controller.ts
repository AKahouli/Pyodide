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
import { createHash } from 'node:crypto';
import { ConflictException } from '../../exceptions';
import { PLATFORM_COPILOT } from '../../agent/constants/platform-copilot.constants';
import { ConversationArtifactService } from '../services/conversation-artifact.service';
import { ResolveCitationUrlDto } from '../dto/resolve-citation-url.dto';
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
    private readonly conversationArtifactService: ConversationArtifactService,
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
    }

    if (dto.requestId) {
      const existingTurn = await this.messageService.findTurnByRequestId(
        conversationId,
        user._id.toString(),
        dto.requestId,
      );
      if (existingTurn) {
        if (existingTurn.requestFingerprint !== requestFingerprint) {
          throw new ConflictException(
            ErrorCode.IDEMPOTENCY_MISMATCH,
            'The request body does not match the idempotent message turn',
          );
        }
        if (platformCopilot) {
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

    const governedRuntime = conversation.runtimeMode === 'governed'
      ? await this.governedRuntimeService.resolveRuntime(user._id.toString(), conversation)
      : undefined;
    if (governedRuntime) this.governedRuntimeService.assertRuntimeRequestAllowed(governedRuntime, dto);

    // Validate model is active for standard conversations only.
    if (!governedRuntime && !platformCopilot && dto.modelId) {
      const modelValidation = await this.modelsService.validateModelActive(dto.modelId, 'chat');
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
      : (await this.resolveAgentIds(
        user._id.toString(),
        dto.agentIds,
        dto.teamIds,
      )) ?? [];
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
      const selectedModel = await this.modelsService.findById(dto.modelId);
      if (!selectedModel?.isActive || selectedModel.supportsReasoning !== true || !selectedModel.reasoning.efforts.some((effort) => effort.id === dto.reasoningEffort)) {
        throw new BadRequestException(ErrorCode.BAD_REQUEST, 'The selected reasoning effort is not supported by this model.');
      }
      effectiveReasoningEffort = dto.reasoningEffort;
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

    // Create user message
    let userMessage: Awaited<ReturnType<MessageService['createUserMessage']>>;
    try {
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
    } catch (error: unknown) {
      if (dto.requestId && typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === 11000) {
        const racedTurn = await this.messageService.findTurnByRequestId(conversationId, user._id.toString(), dto.requestId);
        if (racedTurn?.requestFingerprint === requestFingerprint) {
          if (platformCopilot) {
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
        dto.modelId,
        user.email,
      );
    }

    let aiMessageId: string | undefined;

    // Create AI placeholder and start stream
    if (!dto.memberIds?.length) {
      // Fail fast if AI service is unavailable when we actually need it
      if (!this.streamService.isAvailable()) {
        this.logger.warn('AI service unavailable for response', { conversationId });
        throw new ServiceUnavailableException(
          ErrorCode.CHAT_GRPC_UNAVAILABLE,
          'AI service is currently unavailable',
        );
      }

      const aiMessage = await this.messageService.createAIPlaceholder({
        conversationId,
        questionMessageId: userMessage.id,
        senderId: user._id.toString(),
        modelId: dto.modelId,
        reasoningEffort: effectiveReasoningEffort,
        requestId,
      });
      aiMessageId = aiMessage.id;

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
          reasoningEffort: effectiveReasoningEffort,
          agentIds: effectiveAgentIds,
          connectorRepo: dto.connectorRepo,
          skillIds: dto.skillIds,
          clientContext: dto.clientContext,
        }, requestId, undefined, this.resolveDisplayName(user), governedRuntime ? {
          runtimeMode: 'governed',
          primaryAgentId: governedRuntime.primaryAgentId,
          allowedAgentIds: governedRuntime.allowedAgentIds,
          workspaceIds: governedRuntime.workspaceIds,
          revisionId: governedRuntime.revisionId,
          scopeId: governedRuntime.scopeId,
        } : undefined)
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
        memberTagCount: dto.memberIds.length,
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
      }, dto.requestId, undefined, this.resolveDisplayName(user)).catch((error: unknown) => {
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

  private fingerprintTurn(dto: SendMessageDto): string {
    const canonical = {
      content: dto.content,
      attachedFileIds: dto.attachedFileIds ?? [],
      webSearchEnabled: dto.webSearchEnabled ?? false,
      deepSearchEnabled: dto.deepSearchEnabled ?? false,
      modelId: dto.modelId ?? null,
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

  @Patch(':messageId/feedback')
  async updateFeedback(
    @Param('messageId') messageId: string,
    @Body() dto: MessageFeedbackDto,
  ) {
    return this.messageService.updateFeedback(messageId, dto.feedback);
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

    // Start streaming (non-blocking)
    this.streamService
      .startStream(
        user._id.toString(),
        conversationId,
        newAiMessage.id,
        userMessage.replayContext ? {
          ...userMessage.replayContext,
          ...(pinnedAgentId ? {
            agentIds: [pinnedAgentId],
            modelId: undefined,
            skillIds: [],
            connectorRepo: undefined,
          } : {}),
        } : {
          content: userMessage.content || '',
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
