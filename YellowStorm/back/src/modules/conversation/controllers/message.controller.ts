import {
  Controller,
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
import { ServiceUnavailableException, BadRequestException, NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { CheckUsage } from '../../usage/decorators/check-usage.decorator';
import { UsageLimitGuard } from '../../usage/guards/usage-limit.guard';
import { RequestContextService } from '../../request-context';
import { LoggerService } from '../../logger';
import { UserDocument } from '../../user/schemas/user.schema';
import { resolveStickyAgentRouting } from '../utils/sticky-agent-routing';
import { ChoiceInteractionService } from '../services/choice-interaction.service';
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
  ) {
    this.logger.setContext('MessageController');
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
    const requestId = this.requestContext.getRequestId();

    // DEBUG: Log user object to verify email is present
    this.logger.log('[DEBUG] User object received', {
      userId: user._id,
      email: user.email,
      hasEmail: !!user.email,
      userKeys: Object.keys(user),
    });

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

    // If files attached, ensure system workspace exists
    if (dto.attachedFileIds?.length) {
      await this.conversationService.ensureSystemWorkspace(
        user._id.toString(),
        conversationId,
      );
    }

    // Validate model is active
    if (dto.modelId) {
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
    const conversation = await this.conversationService.getConversationDocument(conversationId);
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
    const mentionedAgentIds =
      (await this.resolveAgentIds(
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

    if (shouldReplaceSticky && effectiveAgentIds?.length) {
      await this.conversationService.replaceTaggedAgentIds(
        conversationId,
        effectiveAgentIds,
      );
    }

    const canonicalChoice = dto.interaction
      ? await this.choiceInteractionService.canonicalize(conversationId, dto.interaction)
      : undefined;

    // Create user message
    const userMessage = await this.messageService.createUserMessage({
      conversationId,
      senderId: user._id.toString(),
      content: canonicalChoice?.content ?? dto.content,
      attachedFileIds: dto.attachedFileIds,
      webSearchEnabled: dto.webSearchEnabled,
      modelId: dto.modelId,
      agentIds: effectiveAgentIds,
      memberIds: dto.memberIds,
      requestId,
      parentMessageId: dto.parentMessageId,
      interaction: canonicalChoice?.interaction,
    });

    // Fire and forget - generate conversation name asynchronously on first message
    if (isFirstMessage) {
      this.streamService.generateConversationNameAsync(
        user._id.toString(),
        conversationId,
        canonicalChoice?.content ?? dto.content,
        dto.modelId,
        user.email,
      );
    }

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
        requestId,
      });

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
          content: canonicalChoice?.content ?? dto.content,
          attachedFileIds: dto.attachedFileIds,
          webSearchEnabled: dto.webSearchEnabled,
          deepSearchEnabled: dto.deepSearchEnabled,
          modelId: dto.modelId,
          agentIds: effectiveAgentIds,
          connectorRepo: dto.connectorRepo,
          skillIds: dto.skillIds,
        }, requestId, undefined, this.resolveDisplayName(user))
        .catch((err) => {
          this.logger.error('Stream start failed', {
            conversationId,
            aiMessageId: aiMessage.id,
            error: (err as Error).message,
          });
          this.messageService.markStreamFailed(aiMessage.id);
        });
    } else {
      this.logger.log('Skipping AI response due to member tags', {
        conversationId,
        memberTagCount: dto.memberIds.length,
      });
    }

    return { userMessage };
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

    // Create new AI placeholder
    const newAiMessage = await this.messageService.createAIPlaceholder({
      conversationId,
      questionMessageId: questionId,
      requestId,
    });

    this.logger.log('Starting regenerate stream', {
      conversationId,
      originalMessageId: messageId,
      newAiMessageId: newAiMessage.id,
    });

    // Start streaming (non-blocking)
    this.streamService
      .startStream(user._id.toString(), conversationId, newAiMessage.id, {
        content: userMessage.content || '',
        attachedFileIds: userMessage.attachedFileIds?.map((id) => id.toString()),
        webSearchEnabled: userMessage.webSearchEnabled,
        deepSearchEnabled: (userMessage as any).deepSearchEnabled,
        agentIds: userMessage.agentIds?.map((id) => id.toString()),
      }, requestId, undefined, this.resolveDisplayName(user))
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
