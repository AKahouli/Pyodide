import { Injectable, HttpStatus, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateUserMessageData,
  CreateAIPlaceholderData,
  CompleteAIMessageData,
  MessageQueryParams,
  MessageResponse,
  PaginatedMessages,
  FeedbackType,
  AttachedFileResponse,
  MessageComponent,
  ReliabilityEvaluation,
  ResponseCorrectionAttempt,
} from '../interfaces/message.interface';
import type { ConversationLatencyMetricsV1, FrontendLatencyPatch } from '../interfaces/latency.interface';
import { ConversationService } from './conversation.service';
import { StreamGatewayService } from './stream-gateway.service';
import { WorkspaceDocumentService } from '../../workspace/workspace-document.service';
import { LoggerService } from '../../logger';
import { BadRequestException, ConflictException, NotFoundException } from '../../exceptions';
import { AppException } from '../../exceptions/exceptions/base.exception';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { sanitizeTaskDiagnosticItems } from '../utils/task-diagnostics';
import { sanitizePublicComponent } from '../utils/public-component-sanitizer';
import { StreamEvent } from '../interfaces/stream.interface';
import { EmailService } from '../../email/email.service';
import { ConversationSettingsService } from '../../system/conversation-settings.service';
import { MESSAGE_STORE, type MessageRecord, type MessageStore } from '../persistence/message-store';

const SETTINGS_LOOKUP_TIMEOUT_MS = 1_000;

@Injectable()
export class MessageService {
  private readonly appUrl: string;

  constructor(
    @Inject(MESSAGE_STORE) private readonly messageStore: MessageStore,
    private readonly conversationService: ConversationService,
    private readonly streamGateway: StreamGatewayService,
    @Inject(forwardRef(() => WorkspaceDocumentService))
    private readonly workspaceDocumentService: WorkspaceDocumentService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly emailService: EmailService,
    private readonly conversationSettings?: ConversationSettingsService,
  ) {
    this.logger.setContext('MessageService');
    this.appUrl = this.configService.get<string>('app.frontendUrl', 'http://localhost:5173');
  }

  async createUserMessage(data: CreateUserMessageData): Promise<MessageResponse> {
    this.logger.log('Creating user message', {
      conversationId: data.conversationId,
      contentLength: data.content.length,
      attachedFiles: data.attachedFileIds?.length || 0,
    });

    const maxLength = this.configService.get<number>('conversation.maxMessageLength', 50000);

    if (data.content.length > maxLength) {
      this.logger.warn('Message too long', {
        conversationId: data.conversationId,
        contentLength: data.content.length,
        maxLength,
      });
      throw new AppException({
        code: ErrorCode.CHAT_MESSAGE_TOO_LONG,
        message: `Message exceeds maximum length of ${maxLength} characters`,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }

    const maxFiles = this.configService.get<number>('conversation.maxFilesPerMessage', 5);

    if (data.attachedFileIds && data.attachedFileIds.length > maxFiles) {
      this.logger.warn('Too many files attached', {
        conversationId: data.conversationId,
        fileCount: data.attachedFileIds.length,
        maxFiles,
      });
      throw new AppException({
        code: ErrorCode.CHAT_FILE_UPLOAD_LIMIT,
        message: `Maximum ${maxFiles} files per message`,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }
    const message = await this.messageStore.createUser(data);
    if (data.agentIds?.length) {
      await this.conversationService.updateTaggedAgents(data.conversationId, data.agentIds);
    }

    // mention notification
    this.extractAndNotifyMentions(message, data.conversationId).catch((err) =>
      this.logger.error('Failed to process mentions', {
        error: err instanceof Error ? err.message : err,
      }),
    );

    this.logger.log('User message created', {
      messageId: message.id,
      conversationId: data.conversationId,
    });

    const response = this.mapToResponse(message);

    if (message.attachedFileIds?.length) {
      const fileIds = message.attachedFileIds;
      const fileMap = await this.resolveAttachedFiles(fileIds);
      response.attachedFiles = fileIds
        .map((fid) => fileMap.get(fid))
        .filter((f): f is AttachedFileResponse => !!f);
    }

    // Broadcast to group members
    this.broadcastMessage(data.conversationId, {
      type: 'message_created',
      data: {
        conversationId: data.conversationId,
        message: response,
      },
    });

    return response;
  }

  async createAIPlaceholder(data: CreateAIPlaceholderData): Promise<MessageResponse> {
    this.logger.log('Creating AI placeholder', {
      conversationId: data.conversationId,
      questionMessageId: data.questionMessageId,
    });

    const message = await this.messageStore.createAiPlaceholder(data);

    this.logger.log('AI placeholder created', {
      messageId: message.id,
      conversationId: data.conversationId,
    });

    const response = this.mapToResponse(message);

    // Broadcast to group members
    this.broadcastMessage(data.conversationId, {
      type: 'message_created',
      data: {
        conversationId: data.conversationId,
        message: response,
      },
    });

    return response;
  }

  /**
   * Phase 5 pre-agent reduction: user message + AI placeholder persist in one
   * store transaction. Applies the same validation and side effects as
   * createUserMessage, then broadcasts the placeholder creation exactly as
   * createAIPlaceholder would — preserving event order (user first).
   */
  async createUserMessageWithAiPlaceholder(data: CreateUserMessageData & { placeholder: Omit<CreateAIPlaceholderData, 'questionMessageId'> }): Promise<{ userMessage: MessageResponse; aiMessage: MessageResponse }> {
    const maxLength = this.configService.get<number>('conversation.maxMessageLength', 50000);
    if (data.content.length > maxLength) {
      throw new AppException({
        code: ErrorCode.CHAT_MESSAGE_TOO_LONG,
        message: `Message exceeds maximum length of ${String(maxLength)} characters`,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }
    const maxFiles = this.configService.get<number>('conversation.maxFilesPerMessage', 5);
    if (data.attachedFileIds && data.attachedFileIds.length > maxFiles) {
      throw new AppException({
        code: ErrorCode.CHAT_FILE_UPLOAD_LIMIT,
        message: `Maximum ${String(maxFiles)} files per message`,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }

    const { user, placeholder } = await this.messageStore.createUserWithAiPlaceholder({
      user: data,
      placeholder: data.placeholder,
    });

    if (data.agentIds?.length) {
      await this.conversationService.updateTaggedAgents(data.conversationId, data.agentIds);
    }

    // mention notification (fire and forget, same as createUserMessage)
    this.extractAndNotifyMentions(user, data.conversationId).catch((err: unknown) => {
      this.logger.error('Failed to process mentions', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    const userResponse = this.mapToResponse(user);
    if (user.attachedFileIds?.length) {
      const fileIds = user.attachedFileIds;
      const fileMap = await this.resolveAttachedFiles(fileIds);
      userResponse.attachedFiles = fileIds
        .map((fid) => fileMap.get(fid))
        .filter((f): f is AttachedFileResponse => !!f);
    }

    void this.broadcastMessage(data.conversationId, {
      type: 'message_created',
      data: { conversationId: data.conversationId, message: userResponse },
    });

    const placeholderResponse = this.mapToResponse(placeholder);
    void this.broadcastMessage(data.conversationId, {
      type: 'message_created',
      data: { conversationId: data.conversationId, message: placeholderResponse },
    });

    return { userMessage: userResponse, aiMessage: placeholderResponse };
  }

  async completeAIMessage(data: CompleteAIMessageData): Promise<MessageResponse> {
    this.logger.log('Completing AI message', {
      messageId: data.messageId,
      componentCount: data.components?.length || 0,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      durationMs: data.durationMs,
    });

    const guardrailDecision =
      data.guardrailDecision ?? this.findGuardrailDecision(data.components);
    const message = await this.messageStore.completeAi({ ...data, guardrailDecision });

    if (!message) {
      this.logger.error('AI message not found for completion', {
        messageId: data.messageId,
      });
      if (data.streamExecutionLeaseId) {
        throw new ConflictException(
          ErrorCode.CONFLICT,
          'Stream execution lease no longer owns this response',
        );
      }
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'AI message not found');
    }

    // mention notification
    this.extractAndNotifyMentions(message, message.conversationId).catch((err) =>
      this.logger.error('Failed to process mentions', {
        error: err instanceof Error ? err.message : err,
      }),
    );

    this.logger.log('AI message completed', {
      messageId: message.id,
      conversationId: message.conversationId,
    });

    const response = this.mapToResponse(message);

    // Broadcast update
    await this.broadcastMessage(message.conversationId, {
      type: 'message_updated',
      data: {
        conversationId: message.conversationId,
        messageId: message.id,
        message: response,
      },
    });

    return response;
  }

  /**
   * Merge the browser-reported sixth latency metric (frontend paint) into an
   * AI message. Validates ownership boundaries; the store applies the merge
   * idempotently so duplicate reports never overwrite the accepted value.
   */
  async reportFrontendLatency(
    conversationId: string,
    messageId: string,
    requestId: string,
    patch: FrontendLatencyPatch,
  ): Promise<MessageResponse> {
    const message = await this.messageStore.findById(messageId);
    if (!message || message.conversationId !== conversationId) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'AI message not found');
    }
    if (message.conversationType !== 'ai') {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Latency metrics can only be reported for AI messages');
    }
    const updated = await this.messageStore.updateFrontendLatency(messageId, requestId, patch);
    if (!updated) {
      // Either the turn requestId mismatches or the metric was already accepted.
      this.logger.debug('Frontend latency report not applied', { conversationId, messageId });
      return this.mapToResponse(message);
    }
    return this.mapToResponse(updated);
  }

  private async extractAndNotifyMentions(
    message: MessageRecord,
    conversationId: string,
  ): Promise<void> {
    let fullText = '';
    if (message.conversationType === 'ai') {
      const textComponents = (message.components as any[])?.filter((c) => c.type === 'text') || [];
      fullText = textComponents.map((c) => c.data?.content || '').join('\n');
    } else {
      fullText = message.content || '';
    }

    if (!fullText && (!message.memberIds || message.memberIds.length === 0)) return;

    const conversation = await this.conversationService.findById(conversationId);
    if (!conversation.groupMeta?.isGroup) return;

    const members = conversation.groupMeta.members || [];
    if (!members.length) return;

    const mentionedUserIds = new Set<string>();

    // 1. Check explicit memberIds if present
    if (message.memberIds && message.memberIds.length > 0) {
      message.memberIds.forEach((id) => mentionedUserIds.add(id));
    }

    // 2. Fallback to text analysis
    if (fullText) {
      for (const member of members) {
        if (mentionedUserIds.has(member.userId)) continue;

        const memberName = member.name || member.email?.split('@')[0];
        if (!memberName) continue;

        const tagLower = `@${memberName}`.toLowerCase();
        if (fullText.toLowerCase().includes(tagLower)) {
          mentionedUserIds.add(member.userId);
        }
      }
    }

    if (mentionedUserIds.size === 0) return;

    const conversationUrl = `${this.appUrl}/#/conversation/${conversationId}`;
    const emailsToSend: any[] = [];

    for (const userId of mentionedUserIds) {
      const member = members.find((m) => m.userId === userId);
      if (!member) continue;

      // Save mention to database
      await this.conversationService.addMention(conversationId, userId, message.id);

      // Broadcast event
      this.broadcastMention(conversationId, message.id, userId);

      // Prepare email if member has an email
      if (member.email) {
        emailsToSend.push({
          to: member.email,
          subject: `You were mentioned in a conversation on YellowStorm`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.5; color: #333;">
              <h2 style="color: #0f172a;">You have been mentioned!</h2>
              <p>${message.conversationType === 'ai' ? 'The AI agent' : 'A user'} mentioned you in the conversation <strong>${conversation.title}</strong>.</p>
              ${
                fullText
                  ? `
              <p style="margin: 20px 0; padding: 15px; background-color: #f8fafc; border-left: 4px solid #0f172a; border-radius: 4px;">
                <em>"${fullText.substring(0, 200)}${fullText.length > 200 ? '...' : ''}"</em>
              </p>`
                  : ''
              }
              <p>To view the full context and reply, please click the link below:</p>
              <div style="margin: 30px 0;">
                <a href="${conversationUrl}" style="background-color: #0f172a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500; display: inline-block;">View Conversation</a>
              </div>
            </div>
          `,
          text: `${message.conversationType === 'ai' ? 'The AI agent' : 'A user'} mentioned you in the conversation ${conversation.title}.\n\nView here: ${conversationUrl}`,
        });
      }
    }

    if (emailsToSend.length > 0) {
      await this.emailService.sendBulk({ emails: emailsToSend, stopOnError: false });
      this.logger.log('Mention notifications processed', {
        conversationId,
        messageId: message.id,
        emailCount: emailsToSend.length,
        totalMentions: mentionedUserIds.size,
      });
    }
  }

  private broadcastMention(conversationId: string, messageId: string, userId: string): void {
    try {
      this.streamGateway.sendToUser(userId, {
        type: 'mention_created',
        data: {
          conversationId,
          messageId,
          userId,
        },
      });
    } catch (err) {
      this.logger.error('Failed to broadcast mention', {
        userId,
        error: err instanceof Error ? err.message : err,
      });
    }
  }

  async findByConversation(
    conversationId: string,
    params: MessageQueryParams,
  ): Promise<PaginatedMessages | import('../interfaces/message.interface').CursorPaginatedMessages> {
    if ((params.mode ?? 'legacy') === 'cursor') {
      if (params.page !== undefined) {
        throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'page is not valid in cursor mode');
      }
      const limit = params.limit ?? 50;
      const [window, redactSensitiveText] = await Promise.all([
        this.messageStore.listCursor({
          conversationId,
          limit,
          cursor: params.cursor,
          conversationType: params.conversationType,
        }),
        this.resolveRedactSensitiveText(),
      ]);
      const questionIds = window.records
        .filter((message) => message.conversationType === 'user')
        .map((message) => message.id);
      const branches = await this.messageStore.findBranchesByQuestions(questionIds);
      const allRecords = [...window.records, ...[...branches.values()].flat()];
      const fileMap = await this.resolveAttachedFiles(
        allRecords.flatMap((message) => message.attachedFileIds ?? []),
      );
      const mapResponse = (message: MessageRecord): MessageResponse => {
        const response = this.mapToResponse(message, redactSensitiveText);
        if (message.attachedFileIds?.length) {
          response.attachedFiles = message.attachedFileIds
            .map((id) => fileMap.get(id))
            .filter((file): file is AttachedFileResponse => Boolean(file));
        }
        return response;
      };
      return {
        messages: window.records.map(mapResponse),
        branchesByQuestion: Object.fromEntries(
          [...branches].map(([id, records]) => [id, records.map(mapResponse)]),
        ),
        pagination: {
          mode: 'cursor',
          limit,
          hasMore: window.hasMore,
          nextCursor: window.nextCursor,
        },
      };
    }
    if (params.cursor !== undefined) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'cursor requires cursor mode');
    }
    const { page = 1, limit = 50, conversationType } = params;
    const [{ records: messages, total }, redactSensitiveText] = await Promise.all([
      this.messageStore.listPage({
        conversationId,
        page,
        limit,
        conversationType,
      }),
      this.resolveRedactSensitiveText(),
    ]);

    // Batch-resolve attached files for all messages on this page
    const allFileIds: string[] = [];
    for (const m of messages) {
      if (m.attachedFileIds?.length) {
        for (const fid of m.attachedFileIds) {
          allFileIds.push(fid);
        }
      }
    }

    const fileMap = await this.resolveAttachedFiles(allFileIds);

    return {
      messages: messages.map((m) => {
        const response = this.mapToResponse(m, redactSensitiveText);
        if (m.attachedFileIds?.length) {
          response.attachedFiles = m.attachedFileIds
            .map((fid) => fileMap.get(fid))
            .filter((f): f is AttachedFileResponse => !!f);
        }
        return response;
      }),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findById(messageId: string): Promise<MessageResponse> {
    const [message, redactSensitiveText] = await Promise.all([
      this.messageStore.findById(messageId),
      this.resolveRedactSensitiveText(),
    ]);

    if (!message) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Message not found');
    }

    const response = this.mapToResponse(message, redactSensitiveText);

    if (message.attachedFileIds?.length) {
      const fileIds = message.attachedFileIds;
      const fileMap = await this.resolveAttachedFiles(fileIds);
      response.attachedFiles = fileIds
        .map((fid) => fileMap.get(fid))
        .filter((f): f is AttachedFileResponse => !!f);
    }

    return response;
  }

  /**
   * On-demand tool activity result: message responses omit `resultJson` so
   * bulk reads stay small; clients fetch a single tool payload through here.
   * The payload passes through the same sanitizer as the include-results path.
   */
  async findToolActivityResult(conversationId: string, messageId: string, componentId: string): Promise<{ resultJson: string | null }> {
    const [message, redactSensitiveText] = await Promise.all([
      this.messageStore.findById(messageId),
      this.resolveRedactSensitiveText(),
    ]);

    if (!message || String(message.conversationId) !== String(conversationId)) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Message not found');
    }

    const components = Array.isArray(message.components) ? message.components as Array<{ id?: unknown; type?: unknown; data?: Record<string, unknown> }> : [];
    const component = components.find((candidate) => candidate?.id === componentId && candidate?.type === 'toolActivity');
    if (!component) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Tool activity not found');
    }

    const [publicComponent] = this.publicComponents([component], true, redactSensitiveText) ?? [];
    const resultJson = typeof publicComponent?.data?.resultJson === 'string' && publicComponent.data.resultJson.trim()
      ? publicComponent.data.resultJson
      : null;
    return { resultJson };
  }

  async updateFeedback(messageId: string, feedback: FeedbackType): Promise<MessageResponse> {
    const existing = await this.messageStore.findById(messageId);

    if (!existing) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Message not found');
    }

    if (existing.conversationType !== 'ai') {
      throw new AppException({
        code: ErrorCode.CHAT_INVALID_FEEDBACK,
        message: 'Feedback can only be given on AI messages',
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }

    const message = await this.messageStore.updateFeedback(messageId, feedback, new Date());
    if (!message)
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Message not found');

    this.logger.log('Message feedback updated', {
      messageId,
      feedback,
    });

    const response = this.mapToResponse(message);

    // Broadcast update
    this.broadcastMessage(message.conversationId, {
      type: 'message_updated',
      data: {
        conversationId: message.conversationId,
        messageId,
        message: response,
      },
    });

    return response;
  }

  async updateReliabilityEvaluation(
    messageId: string,
    evaluation: ReliabilityEvaluation,
  ): Promise<MessageResponse> {
    const existing = await this.messageStore.findById(messageId);
    if (!existing) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Message not found');
    }
    if (existing.conversationType !== 'ai') {
      throw new AppException({
        code: ErrorCode.BAD_REQUEST,
        message: 'Reliability evaluation applies only to AI messages',
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }

    const message = await this.messageStore.updateReliability(messageId, evaluation);
    if (!message)
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Message not found');
    const response = this.mapToResponse(message);
    await this.broadcastMessage(message.conversationId, {
      type: 'message_updated',
      data: {
        conversationId: message.conversationId,
        messageId,
        message: {
          reliabilityEvaluation: response.reliabilityEvaluation,
        } as Partial<MessageResponse>,
      },
    });
    return response;
  }

  async claimStreamExecution(
    messageId: string,
    leaseId: string,
    leaseDurationMs: number,
  ): Promise<boolean> {
    const now = new Date();
    return this.messageStore.claimStream(
      messageId,
      leaseId,
      now,
      new Date(now.getTime() + leaseDurationMs),
    );
  }

  async renewStreamExecution(
    messageId: string,
    leaseId: string,
    leaseDurationMs: number,
  ): Promise<boolean> {
    return this.messageStore.renewStream(
      messageId,
      leaseId,
      new Date(Date.now() + leaseDurationMs),
    );
  }

  async releaseStreamExecution(messageId: string, leaseId: string): Promise<void> {
    await this.messageStore.releaseStream(messageId, leaseId);
  }

  async findTurnByRequestId(
    conversationId: string,
    senderId: string,
    requestId: string,
  ): Promise<{
    userMessage: MessageResponse;
    aiMessageId?: string;
    requestFingerprint?: string;
  } | null> {
    const turn = await this.messageStore.findTurnByRequestId(conversationId, senderId, requestId);
    if (!turn) return null;
    return {
      userMessage: this.mapToResponse(turn.user),
      aiMessageId: turn.aiId,
      requestFingerprint: turn.user.replayContext?.requestFingerprint,
    };
  }

  async claimReliabilityEvaluation(
    conversationId: string,
    messageId: string,
    manual: boolean,
  ): Promise<MessageResponse | null> {
    if (!/^[0-9a-f]{24}$/.test(conversationId) || !/^[0-9a-f]{24}$/.test(messageId)) {
      if (!manual) return null;
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Message not found');
    }
    const message = await this.messageStore.findById(messageId);
    if (!message || message.conversationId !== conversationId) {
      if (!manual) return null;
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Message not found');
    }

    const components = Array.isArray(message.components) ? message.components : [];
    const hasAnswer =
      message.conversationType === 'ai' &&
      message.isComplete === true &&
      message.isStreaming === false &&
      components.some(
        (component) =>
          component.type === 'text' &&
          typeof component.data?.content === 'string' &&
          component.data.content.trim(),
      ) &&
      !components.some((component) => component.type === 'error') &&
      !!message.questionMessageId;
    if (!hasAnswer) {
      if (!manual) return null;
      throw new AppException({
        code: ErrorCode.BAD_REQUEST,
        message: 'Message cannot be evaluated',
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }

    const correctionInProgress = ['queued', 'correcting', 're_evaluating'];
    if (
      (manual && message.reliabilityEvaluation?.status === 'pending') ||
      correctionInProgress.includes(message.correctionWorkflow?.status ?? '')
    ) {
      if (!manual) return null;
      throw new AppException({
        code: ErrorCode.CONFLICT,
        message: 'A reliability evaluation is already in progress',
        statusCode: HttpStatus.CONFLICT,
      });
    }

    const claimed = await this.messageStore.claimReliability(
      conversationId,
      messageId,
      manual,
      new Date().toISOString(),
    );
    if (!claimed) {
      if (!manual) return null;
      throw new AppException({
        code: ErrorCode.CONFLICT,
        message: 'A reliability evaluation is already in progress',
        statusCode: HttpStatus.CONFLICT,
      });
    }

    const response = this.mapToResponse(claimed);
    await this.broadcastMessage(conversationId, {
      type: 'message_updated',
      data: {
        conversationId,
        messageId,
        message: {
          reliabilityEvaluation: response.reliabilityEvaluation,
        } as Partial<MessageResponse>,
      },
    });
    return response;
  }

  async rerunReliabilityEvaluation(
    conversationId: string,
    messageId: string,
  ): Promise<MessageResponse> {
    const response = await this.claimReliabilityEvaluation(conversationId, messageId, true);
    if (!response) {
      throw new AppException({
        code: ErrorCode.CONFLICT,
        message: 'A reliability evaluation is already in progress',
        statusCode: HttpStatus.CONFLICT,
      });
    }
    return response;
  }

  async updateCorrectionWorkflow(
    messageId: string,
    workflow: NonNullable<MessageResponse['correctionWorkflow']>,
    correctionRunId?: string,
  ): Promise<MessageResponse> {
    const message = await this.messageStore.updateCorrectionWorkflow(
      messageId,
      workflow,
      correctionRunId,
    );
    if (!message)
      throw new NotFoundException(
        ErrorCode.CHAT_MESSAGE_NOT_FOUND,
        correctionRunId ? 'Correction run ownership lost' : 'AI message not found',
      );
    const response = this.mapToResponse(message);
    await this.broadcastMessage(message.conversationId, {
      type: 'message_updated',
      data: {
        conversationId: message.conversationId,
        messageId,
        message: { correctionWorkflow: response.correctionWorkflow } as Partial<MessageResponse>,
      },
    });
    return response;
  }

  async claimCorrectionRun(
    messageId: string,
    runId: string,
    leaseExpiresAt: string,
  ): Promise<boolean> {
    return this.messageStore.claimCorrectionRun(
      messageId,
      runId,
      leaseExpiresAt,
      new Date().toISOString(),
    );
  }

  async upsertCorrectionAttempt(
    messageId: string,
    attempt: ResponseCorrectionAttempt,
    correctionRunId?: string,
  ): Promise<MessageResponse> {
    const sanitizedAttempt = { ...attempt, components: this.publicComponents(attempt.components) };
    const message = await this.messageStore.upsertCorrectionAttempt(
      messageId,
      sanitizedAttempt,
      correctionRunId,
    );
    if (!message)
      throw new NotFoundException(
        ErrorCode.CHAT_MESSAGE_NOT_FOUND,
        correctionRunId ? 'Correction run ownership lost' : 'Correction workflow not found',
      );
    const response = this.mapToResponse(message);
    await this.broadcastMessage(message.conversationId, {
      type: 'message_updated',
      data: {
        conversationId: message.conversationId,
        messageId,
        message: { correctionWorkflow: response.correctionWorkflow } as Partial<MessageResponse>,
      },
    });
    return response;
  }

  async markStaleReliabilityEvaluationsFailed(cutoff: Date): Promise<number> {
    const messages = await this.messageStore.failStaleReliability(cutoff);
    for (const message of messages) {
      const response = this.mapToResponse(message);
      await this.broadcastMessage(message.conversationId, {
        type: 'message_updated',
        data: {
          conversationId: message.conversationId,
          messageId: message.id,
          message: {
            reliabilityEvaluation: response.reliabilityEvaluation,
          } as Partial<MessageResponse>,
        },
      });
    }
    return messages.length;
  }

  async touchPendingReliabilityEvaluations(messageIds: string[]): Promise<void> {
    if (!messageIds.length) return;
    await this.messageStore.touchPendingReliability(messageIds, new Date());
  }

  async getMessageDocument(messageId: string): Promise<MessageRecord> {
    const message = await this.messageStore.findById(messageId);

    if (!message) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Message not found');
    }

    return message;
  }

  async findAllByConversation(conversationId: string): Promise<MessageRecord[]> {
    return this.messageStore.listByConversation(conversationId);
  }

  async markStreamFailed(messageId: string, streamExecutionLeaseId?: string): Promise<void> {
    await this.messageStore.markStreamFailed(messageId, streamExecutionLeaseId);
  }

  async cleanupStaleStreams(olderThanMinutes: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
    return this.messageStore.cleanupStaleStreams(cutoff);
  }

  async updateUserMessage(
    messageId: string,
    content: string,
    agentIds?: string[],
    memberIds?: string[],
  ): Promise<MessageResponse> {
    const existing = await this.messageStore.findById(messageId);

    if (!existing) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Message not found');
    }

    if (existing.conversationType !== 'user') {
      throw new AppException({
        code: ErrorCode.CHAT_INVALID_FEEDBACK,
        message: 'Only user messages can be edited',
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }

    const message = await this.messageStore.updateUser(messageId, {
      content,
      agentIds,
      memberIds,
      editedAt: new Date(),
    });
    if (!message)
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Message not found');
    if (agentIds?.length)
      await this.conversationService.updateTaggedAgents(message.conversationId, agentIds);

    this.logger.log('User message updated', { messageId });

    const response = this.mapToResponse(message);

    // Broadcast update
    this.broadcastMessage(message.conversationId, {
      type: 'message_updated',
      data: {
        conversationId: message.conversationId,
        messageId,
        message: response,
      },
    });

    return response;
  }

  async deleteByConversation(conversationId: string): Promise<number> {
    return this.messageStore.deleteByConversation(conversationId);
  }

  async findBranchesByQuestion(questionMessageId: string): Promise<MessageResponse[]> {
    const messages = await this.messageStore.findBranchesByQuestion(questionMessageId);

    return messages.map((m) => this.mapToResponse(m));
  }

  /**
   * Resolve attached file IDs to AttachedFileResponse objects with presigned download URLs.
   * Returns a Map for efficient lookup.
   */
  private async resolveAttachedFiles(
    fileIds: string[],
  ): Promise<Map<string, AttachedFileResponse>> {
    const map = new Map<string, AttachedFileResponse>();
    if (fileIds.length === 0) return map;

    try {
      const documents = await this.workspaceDocumentService.findByIds(fileIds);

      await Promise.all(
        documents.map(async (doc) => {
          try {
            const downloadUrl = doc.path
              ? await this.workspaceDocumentService.generateReadUrl(doc.path)
              : '';
            map.set(doc.id, {
              id: doc.id,
              originalName: doc.originalName,
              mimeType: doc.mimeType,
              size: doc.size,
              downloadUrl,
            });
          } catch (err) {
            this.logger.warn('Failed to generate download URL for attached file', {
              documentId: doc.id,
              error: err instanceof Error ? err.message : 'Unknown error',
            });
          }
        }),
      );
    } catch (err) {
      this.logger.warn('Failed to resolve attached files', {
        fileIds,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }

    return map;
  }

  private mapToResponse(message: MessageRecord, redactSensitiveText?: boolean): MessageResponse {
    const toStr = (v: any) => v?.toString?.() ?? v;
    const toISO = (v: any) => (v instanceof Date ? v.toISOString() : v);
    return {
      id: message.id,
      conversationId: toStr(message.conversationId),
      conversationType: message.conversationType as 'user' | 'ai',
      content: message.content,
      components: this.publicComponents(message.components, false, redactSensitiveText) as any,
      attachedFileIds: message.attachedFileIds?.map((id: any) => toStr(id)),
      modelId: message.modelId,
      reasoningEffort: message.reasoningEffort,
      webSearchEnabled: message.webSearchEnabled,
      questionMessageId: toStr(message.questionMessageId),
      answerMessageId: toStr(message.answerMessageId),
      feedback: message.feedback as any,
      feedbackAt: toISO(message.feedbackAt),
      isEdited: message.isEdited || undefined,
      editedAt: toISO(message.editedAt),
      isStreaming: message.isStreaming,
      isComplete: message.isComplete,
      inputTokens: message.inputTokens,
      outputTokens: message.outputTokens,
      modelRequestTelemetry: message.modelRequestTelemetry,
      durationMs: message.durationMs,
      timeToFirstChunk: message.timeToFirstChunk,
      timeToFirstToken: message.timeToFirstToken,
      latencyMetrics: message.latencyMetrics as ConversationLatencyMetricsV1 | undefined,
      requestId: message.requestId,
      guardrailDecision: message.guardrailDecision as any,
      interaction: message.interaction as Record<string, unknown> | undefined,
      interactions: message.interactions as Record<string, unknown>[] | undefined,
      reliabilityEvaluation: message.reliabilityEvaluation as ReliabilityEvaluation | undefined,
      correctionWorkflow: message.correctionWorkflow
        ? ({
            ...message.correctionWorkflow,
            ...(message.correctionWorkflow.correctedComponents
              ? {
                  correctedComponents: this.publicComponents(
                    message.correctionWorkflow.correctedComponents,
                    false,
                    redactSensitiveText,
                  ),
                }
              : {}),
            ...(message.correctionWorkflow.attempts
              ? {
                  attempts: message.correctionWorkflow.attempts.map(
                    (attempt: ResponseCorrectionAttempt) => ({
                      ...attempt,
                      components: this.publicComponents(
                        attempt.components,
                        false,
                        redactSensitiveText,
                      ),
                    }),
                  ),
                }
              : {}),
          } as MessageResponse['correctionWorkflow'])
        : undefined,
      agentIds: message.agentIds?.map((id: any) => toStr(id)),
      memberIds: message.memberIds?.map((id: any) => toStr(id)),
      senderId: toStr(message.senderId),
      parentMessageId: toStr(message.parentMessageId),
      createdAt: toISO(message.createdAt),
      updatedAt: toISO(message.updatedAt),
    };
  }

  private publicComponents(
    components: unknown,
    includeToolResults = false,
    resolvedRedactSensitiveText?: boolean,
  ): MessageComponent[] | undefined {
    if (!Array.isArray(components)) return undefined;
    const redactSensitiveText = resolvedRedactSensitiveText
      ?? this.conversationSettings?.shouldRedactSensitiveText() !== false;
    const options = { redactSensitiveText, includeAgentDetail: true };
    return components.map((component) => {
      if (component?.type === 'task' && component.data) {
        return sanitizePublicComponent(
          {
            id: component.id,
            type: component.type,
            data: {
              ...component.data,
              items: redactSensitiveText
                ? sanitizeTaskDiagnosticItems(component.data.items)
                : component.data.items,
            },
          },
          options,
        );
      }
      if (!component?.data) return component;
      if (component.type !== 'toolActivity' || includeToolResults) {
        return sanitizePublicComponent(
          { id: component.id, type: component.type, data: { ...component.data } },
          options,
        );
      }
      const {
        resultJson: _resultJson,
        result_json: _resultJsonSnake,
        ...publicData
      } = component.data;
      return sanitizePublicComponent(
        { id: component.id, type: component.type, data: publicData },
        options,
      );
    });
  }

  private async resolveRedactSensitiveText(): Promise<boolean> {
    if (!this.conversationSettings) return true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const settings = await Promise.race([
        this.conversationSettings.getSettings(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Conversation redaction setting lookup timed out')),
            SETTINGS_LOOKUP_TIMEOUT_MS,
          );
        }),
      ]);
      return settings.redactSensitiveText !== false;
    } catch (error) {
      this.logger.warn('Failed to resolve conversation redaction setting', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return true;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private findGuardrailDecision(
    components: MessageComponent[],
  ): CompleteAIMessageData['guardrailDecision'] {
    for (const component of components) {
      const decision = component.data?.guardrailDecision;
      if (decision && typeof decision === 'object') {
        return decision as CompleteAIMessageData['guardrailDecision'];
      }
    }
    return undefined;
  }

  private async broadcastMessage(conversationId: string, event: StreamEvent): Promise<void> {
    try {
      const conversation = await this.conversationService.findById(conversationId);
      const userIds: string[] = [conversation.createdBy];

      if (conversation.groupMeta?.isGroup) {
        conversation.groupMeta.members.forEach((member) => {
          if (!userIds.includes(member.userId)) {
            userIds.push(member.userId);
          }
        });
      }

      await this.streamGateway.broadcastToConversation(userIds, event);
    } catch (err) {
      this.logger.warn('Failed to broadcast message event', {
        conversationId,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }
}
