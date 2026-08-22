import { Injectable, HttpStatus, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { Message, MessageDocument } from '../schemas/message.schema';
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
import { ConversationService } from './conversation.service';
import { StreamGatewayService } from './stream-gateway.service';
import { WorkspaceDocumentService } from '../../workspace/workspace-document.service';
import { LoggerService } from '../../logger';
import { ConflictException, NotFoundException } from '../../exceptions';
import { AppException } from '../../exceptions/exceptions/base.exception';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { sanitizeTaskDiagnosticItems } from '../utils/task-diagnostics';
import { sanitizePublicComponent } from '../utils/public-component-sanitizer';
import { StreamEvent } from '../interfaces/stream.interface';
import { EmailService } from '../../email/email.service';

@Injectable()
export class MessageService {
  private readonly appUrl: string;

  constructor(
    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,
    private readonly conversationService: ConversationService,
    private readonly streamGateway: StreamGatewayService,
    @Inject(forwardRef(() => WorkspaceDocumentService))
    private readonly workspaceDocumentService: WorkspaceDocumentService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly emailService: EmailService,
  ) {
    this.logger.setContext('MessageService');
    this.appUrl = this.configService.get<string>(
      'app.frontendUrl',
      'http://localhost:5173',
    );
  }

  async createUserMessage(data: CreateUserMessageData): Promise<MessageResponse> {
    this.logger.log('Creating user message', {
      conversationId: data.conversationId,
      contentLength: data.content.length,
      attachedFiles: data.attachedFileIds?.length || 0,
    });

    const maxLength = this.configService.get<number>(
      'conversation.maxMessageLength',
      50000,
    );

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

    const maxFiles = this.configService.get<number>(
      'conversation.maxFilesPerMessage',
      5,
    );

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
    const message = await this.messageModel.create({
      conversationId: new Types.ObjectId(data.conversationId),
      senderId: new Types.ObjectId(data.senderId),
      parentMessageId: data.parentMessageId ? new Types.ObjectId(data.parentMessageId) : undefined,
      conversationType: 'user',
      content: data.content,
      attachedFileIds: data.attachedFileIds?.map((id) => new Types.ObjectId(id)),
      webSearchEnabled: data.webSearchEnabled || false,
      modelId: data.modelId,
      reasoningEffort: data.reasoningEffort,
      agentIds: data.agentIds?.map((id) => new Types.ObjectId(id)),
      memberIds: data.memberIds?.map((id) => new Types.ObjectId(id)),
      isStreaming: false,
      isComplete: true,
      requestId: data.requestId,
      interaction: data.interaction,
      interactions: data.interactions,
      replayContext: data.replayContext,
    });

    // Update conversation
    await this.conversationService.addMessageRef(data.conversationId, message._id.toString());
    await this.conversationService.updateLastMessageAt(data.conversationId);

    // Persist tagged agents for group conversations
    if (data.agentIds && data.agentIds.length > 0) {
      await this.conversationService.updateTaggedAgents(data.conversationId, data.agentIds);
    }

    // mention notification
    this.extractAndNotifyMentions(message, data.conversationId)
      .catch((err) => this.logger.error('Failed to process mentions', { error: err instanceof Error ? err.message : err }));

    this.logger.log('User message created', {
      messageId: message._id.toString(),
      conversationId: data.conversationId,
    });

    const response = this.mapToResponse(message);

    if (message.attachedFileIds?.length) {
      const fileIds = message.attachedFileIds.map((id) => id.toString());
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

    const message = await this.messageModel.create({
      conversationId: new Types.ObjectId(data.conversationId),
      conversationType: 'ai',
      senderId: data.senderId ? new Types.ObjectId(data.senderId) : undefined,
      modelId: data.modelId,
      reasoningEffort: data.reasoningEffort,
      questionMessageId: new Types.ObjectId(data.questionMessageId),
      isStreaming: true,
      isComplete: false,
      components: [],
      requestId: data.requestId,
    });

    // Link question to answer — only set if not already linked (preserves first answer for branching)
    const questionMsg = await this.messageModel.findById(data.questionMessageId);
    if (questionMsg && !questionMsg.answerMessageId) {
      questionMsg.answerMessageId = message._id;
      await questionMsg.save();
    }

    // Update conversation
    await this.conversationService.addMessageRef(data.conversationId, message._id.toString());

    this.logger.log('AI placeholder created', {
      messageId: message._id.toString(),
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

  async completeAIMessage(data: CompleteAIMessageData): Promise<MessageResponse> {
    this.logger.log('Completing AI message', {
      messageId: data.messageId,
      componentCount: data.components?.length || 0,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      durationMs: data.durationMs,
    });

    const guardrailDecision = (data.guardrailDecision ?? this.findGuardrailDecision(data.components)) as Record<string, unknown> | undefined;
    let message: MessageDocument | null;
    if (data.streamExecutionLeaseId) {
      message = await this.messageModel.findOneAndUpdate(
        {
          _id: new Types.ObjectId(data.messageId),
          streamExecutionLeaseId: data.streamExecutionLeaseId,
          isComplete: { $ne: true },
        },
        {
          $set: {
            components: data.components,
            isStreaming: false,
            isComplete: true,
            inputTokens: data.inputTokens,
            outputTokens: data.outputTokens,
            durationMs: data.durationMs,
            timeToFirstChunk: data.timeToFirstChunk,
            timeToFirstToken: data.timeToFirstToken,
            modelRequestTelemetry: data.modelRequestTelemetry,
            guardrailDecision,
          },
        },
        { new: true },
      ).exec();
    } else {
      message = await this.messageModel.findById(data.messageId);
    }

    if (!message) {
      this.logger.error('AI message not found for completion', {
        messageId: data.messageId,
      });
      if (data.streamExecutionLeaseId) {
        throw new ConflictException(ErrorCode.CONFLICT, 'Stream execution lease no longer owns this response');
      }
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'AI message not found');
    }

    if (!data.streamExecutionLeaseId) {
      message.components = data.components as any;
      message.isStreaming = false;
      message.isComplete = true;
      message.inputTokens = data.inputTokens;
      message.outputTokens = data.outputTokens;
      message.durationMs = data.durationMs;
      message.timeToFirstChunk = data.timeToFirstChunk;
      message.timeToFirstToken = data.timeToFirstToken;
      message.modelRequestTelemetry = data.modelRequestTelemetry;
      message.guardrailDecision = guardrailDecision;
      await message.save();
    }

    // mention notification
    this.extractAndNotifyMentions(message, message.conversationId.toString())
      .catch((err) => this.logger.error('Failed to process mentions', { error: err instanceof Error ? err.message : err }));

    // Update conversation lastMessageAt
    await this.conversationService.updateLastMessageAt(
      message.conversationId.toString(),
    );

    this.logger.log('AI message completed', {
      messageId: message._id.toString(),
      conversationId: message.conversationId.toString(),
    });

    const response = this.mapToResponse(message);

    // Broadcast update
    await this.broadcastMessage(message.conversationId.toString(), {
      type: 'message_updated',
      data: {
        conversationId: message.conversationId.toString(),
        messageId: message._id.toString(),
        message: response,
      },
    });

    return response;
  }

  private async extractAndNotifyMentions(message: MessageDocument, conversationId: string): Promise<void> {
    let fullText = '';
    if (message.conversationType === 'ai') {
      const textComponents = (message.components as any[])?.filter(c => c.type === 'text') || [];
      fullText = textComponents.map(c => c.data?.content || '').join('\n');
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
      message.memberIds.forEach(id => mentionedUserIds.add(id.toString()));
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
      const member = members.find(m => m.userId === userId);
      if (!member) continue;

      // Save mention to database
      await this.conversationService.addMention(conversationId, userId, message._id.toString());

      // Broadcast event
      this.broadcastMention(conversationId, message._id.toString(), userId);

      // Prepare email if member has an email
      if (member.email) {
        emailsToSend.push({
          to: member.email,
          subject: `You were mentioned in a conversation on YellowStorm`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.5; color: #333;">
              <h2 style="color: #0f172a;">You have been mentioned!</h2>
              <p>${message.conversationType === 'ai' ? 'The AI agent' : 'A user'} mentioned you in the conversation <strong>${conversation.title}</strong>.</p>
              ${fullText ? `
              <p style="margin: 20px 0; padding: 15px; background-color: #f8fafc; border-left: 4px solid #0f172a; border-radius: 4px;">
                <em>"${fullText.substring(0, 200)}${fullText.length > 200 ? '...' : ''}"</em>
              </p>` : ''}
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
        messageId: message._id.toString(),
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
      this.logger.error('Failed to broadcast mention', { userId, error: err instanceof Error ? err.message : err });
    }
  }

  async findByConversation(
    conversationId: string,
    params: MessageQueryParams,
  ): Promise<PaginatedMessages> {
    const { page = 1, limit = 50, conversationType } = params;
    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = {
      conversationId: new Types.ObjectId(conversationId),
    };

    if (conversationType) {
      query.conversationType = conversationType;
    }

    const [messages, total] = await Promise.all([
      this.messageModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.messageModel.countDocuments(query),
    ]);

    // Reverse so messages are returned oldest-to-newest within each page
    messages.reverse();

    // Batch-resolve attached files for all messages on this page
    const allFileIds: string[] = [];
    for (const m of messages) {
      if (m.attachedFileIds?.length) {
        for (const fid of m.attachedFileIds) {
          allFileIds.push(fid.toString());
        }
      }
    }

    const fileMap = await this.resolveAttachedFiles(allFileIds);

    return {
      messages: messages.map((m) => {
        const response = this.mapToResponse(m);
        if (m.attachedFileIds?.length) {
          response.attachedFiles = m.attachedFileIds
            .map((fid) => fileMap.get(fid.toString()))
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
    const message = await this.messageModel.findById(messageId);

    if (!message) {
      throw new NotFoundException(
        ErrorCode.CHAT_MESSAGE_NOT_FOUND,
        'Message not found',
      );
    }

    const response = this.mapToResponse(message);

    if (message.attachedFileIds?.length) {
      const fileIds = message.attachedFileIds.map((id) => id.toString());
      const fileMap = await this.resolveAttachedFiles(fileIds);
      response.attachedFiles = fileIds
        .map((fid) => fileMap.get(fid))
        .filter((f): f is AttachedFileResponse => !!f);
    }

    return response;
  }

  async updateFeedback(
    messageId: string,
    feedback: FeedbackType,
  ): Promise<MessageResponse> {
    const message = await this.messageModel.findById(messageId);

    if (!message) {
      throw new NotFoundException(
        ErrorCode.CHAT_MESSAGE_NOT_FOUND,
        'Message not found',
      );
    }

    if (message.conversationType !== 'ai') {
      throw new AppException({
        code: ErrorCode.CHAT_INVALID_FEEDBACK,
        message: 'Feedback can only be given on AI messages',
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }

    message.feedback = feedback;
    message.feedbackAt = new Date();
    await message.save();

    this.logger.log('Message feedback updated', {
      messageId,
      feedback,
    });

    const response = this.mapToResponse(message);

    // Broadcast update
    this.broadcastMessage(message.conversationId.toString(), {
      type: 'message_updated',
      data: {
        conversationId: message.conversationId.toString(),
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
    const message = await this.messageModel.findById(messageId);
    if (!message) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Message not found');
    }
    if (message.conversationType !== 'ai') {
      throw new AppException({
        code: ErrorCode.BAD_REQUEST,
        message: 'Reliability evaluation applies only to AI messages',
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }

    message.reliabilityEvaluation = evaluation;
    message.reliabilityEvaluationHeartbeatAt = evaluation.status === 'pending' ? new Date() : undefined;
    await message.save();
    const response = this.mapToResponse(message);
    await this.broadcastMessage(message.conversationId.toString(), {
      type: 'message_updated',
      data: {
        conversationId: message.conversationId.toString(),
        messageId,
        message: { reliabilityEvaluation: response.reliabilityEvaluation } as Partial<MessageResponse>,
      },
    });
    return response;
  }

  async claimStreamExecution(messageId: string, leaseId: string, leaseDurationMs: number): Promise<boolean> {
    const now = new Date();
    const claimed = await this.messageModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(messageId),
        conversationType: 'ai',
        isComplete: { $ne: true },
        $or: [
          { streamExecutionLeaseExpiresAt: { $exists: false } },
          { streamExecutionLeaseExpiresAt: null },
          { streamExecutionLeaseExpiresAt: { $lte: now } },
        ],
      },
      {
        $set: {
          streamExecutionLeaseId: leaseId,
          streamExecutionLeaseExpiresAt: new Date(now.getTime() + leaseDurationMs),
        },
      },
      { new: true },
    ).lean().exec();
    return Boolean(claimed);
  }

  async renewStreamExecution(messageId: string, leaseId: string, leaseDurationMs: number): Promise<boolean> {
    const result = await this.messageModel.updateOne(
      { _id: new Types.ObjectId(messageId), streamExecutionLeaseId: leaseId, isComplete: { $ne: true } },
      { $set: { streamExecutionLeaseExpiresAt: new Date(Date.now() + leaseDurationMs) } },
    ).exec();
    return result.modifiedCount === 1;
  }

  async releaseStreamExecution(messageId: string, leaseId: string): Promise<void> {
    await this.messageModel.updateOne(
      { _id: new Types.ObjectId(messageId), streamExecutionLeaseId: leaseId },
      { $unset: { streamExecutionLeaseId: '', streamExecutionLeaseExpiresAt: '' } },
    ).exec();
  }

  async findTurnByRequestId(
    conversationId: string,
    senderId: string,
    requestId: string,
  ): Promise<{ userMessage: MessageResponse; aiMessageId?: string; requestFingerprint?: string } | null> {
    const userMessage = await this.messageModel.findOne({
      conversationId: new Types.ObjectId(conversationId),
      senderId: new Types.ObjectId(senderId),
      conversationType: 'user',
      requestId,
    }).exec();
    if (!userMessage) return null;
    const aiMessage = await this.messageModel.findOne({
      conversationId: new Types.ObjectId(conversationId),
      senderId: new Types.ObjectId(senderId),
      conversationType: 'ai',
      questionMessageId: userMessage._id,
      requestId,
    }).select('_id').lean().exec();
    return {
      userMessage: this.mapToResponse(userMessage),
      aiMessageId: aiMessage?._id?.toString(),
      requestFingerprint: userMessage.replayContext?.requestFingerprint,
    };
  }

  async claimReliabilityEvaluation(conversationId: string, messageId: string, manual: boolean): Promise<MessageResponse | null> {
    if (!Types.ObjectId.isValid(conversationId) || !Types.ObjectId.isValid(messageId)) {
      if (!manual) return null;
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Message not found');
    }
    const messageObjectId = new Types.ObjectId(messageId);
    const conversationObjectId = new Types.ObjectId(conversationId);
    const message = await this.messageModel.findOne({ _id: messageObjectId, conversationId: conversationObjectId });
    if (!message) {
      if (!manual) return null;
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Message not found');
    }

    const components = Array.isArray(message.components) ? message.components : [];
    const hasAnswer = message.conversationType === 'ai'
      && message.isComplete === true
      && message.isStreaming === false
      && components.some((component) => component.type === 'text'
        && typeof component.data?.content === 'string' && component.data.content.trim())
      && !components.some((component) => component.type === 'error')
      && !!message.questionMessageId;
    if (!hasAnswer) {
      if (!manual) return null;
      throw new AppException({
        code: ErrorCode.BAD_REQUEST,
        message: 'Message cannot be evaluated',
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }

    const correctionInProgress = ['queued', 'correcting', 're_evaluating'];
    if ((manual && message.reliabilityEvaluation?.status === 'pending')
      || correctionInProgress.includes(message.correctionWorkflow?.status ?? '')) {
      if (!manual) return null;
      throw new AppException({
        code: ErrorCode.CONFLICT,
        message: 'A reliability evaluation is already in progress',
        statusCode: HttpStatus.CONFLICT,
      });
    }

    const requestedAt = new Date().toISOString();
    const claimFilter = {
        _id: messageObjectId,
        conversationId: conversationObjectId,
        'correctionWorkflow.status': { $nin: correctionInProgress },
        ...(manual
          ? { 'reliabilityEvaluation.status': { $ne: 'pending' } }
          : { reliabilityEvaluation: { $exists: false } }),
      };
    const claimed = await this.messageModel.findOneAndUpdate(
      claimFilter,
      {
        $set: {
          reliabilityEvaluation: { status: 'pending', requestedAt },
          reliabilityEvaluationHeartbeatAt: new Date(),
        },
      },
      { new: true },
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
        message: { reliabilityEvaluation: response.reliabilityEvaluation } as Partial<MessageResponse>,
      },
    });
    return response;
  }

  async rerunReliabilityEvaluation(conversationId: string, messageId: string): Promise<MessageResponse> {
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

  async updateCorrectionWorkflow(messageId: string, workflow: NonNullable<MessageResponse['correctionWorkflow']>, correctionRunId?: string): Promise<MessageResponse> {
    let message = await this.messageModel.findById(messageId);
    if (!message || message.conversationType !== 'ai') throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'AI message not found');
    if (correctionRunId && message.correctionWorkflow?.correctionRunId !== correctionRunId) throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Correction run ownership lost');
    const nextWorkflow = { ...(message.correctionWorkflow || {}), ...workflow, attempts: workflow.attempts ?? message.correctionWorkflow?.attempts } as typeof workflow;
    if (correctionRunId) {
      message = await this.messageModel.findOneAndUpdate({ _id: messageId, 'correctionWorkflow.correctionRunId': correctionRunId }, { $set: { correctionWorkflow: nextWorkflow } }, { new: true });
      if (!message) throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Correction run ownership lost');
    } else {
      message.correctionWorkflow = nextWorkflow;
      await message.save();
    }
    const response = this.mapToResponse(message);
    await this.broadcastMessage(message.conversationId.toString(), {
      type: 'message_updated',
      data: {
        conversationId: message.conversationId.toString(),
        messageId,
        message: { correctionWorkflow: response.correctionWorkflow } as Partial<MessageResponse>,
      },
    });
    return response;
  }

  async claimCorrectionRun(messageId: string, runId: string, leaseExpiresAt: string): Promise<boolean> {
    const now = new Date().toISOString();
    const message = await this.messageModel.findOneAndUpdate({
      _id: messageId,
      conversationType: 'ai',
      'reliabilityEvaluation.status': { $ne: 'pending' },
      $or: [
        { 'correctionWorkflow.correctionRunId': { $exists: false } },
        { 'correctionWorkflow.status': { $in: ['corrected', 'failed', 'abstained', 'human_review_required'] } },
        { 'correctionWorkflow.leaseExpiresAt': { $lt: now } },
      ],
    }, {
      $set: {
        'correctionWorkflow.correctionRunId': runId,
        'correctionWorkflow.leaseExpiresAt': leaseExpiresAt,
        'correctionWorkflow.status': 'queued',
        'correctionWorkflow.activeVersion': 'original',
      },
    }, { new: true });
    return Boolean(message);
  }

  async upsertCorrectionAttempt(messageId: string, attempt: ResponseCorrectionAttempt, correctionRunId?: string): Promise<MessageResponse> {
    let message = await this.messageModel.findById(messageId);
    if (!message || message.conversationType !== 'ai') {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'AI message not found');
    }
    const workflow = message.correctionWorkflow;
    if (!workflow) throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Correction workflow not found');
    if (correctionRunId && workflow.correctionRunId !== correctionRunId) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Correction run ownership lost');
    }
    const attempts = [...(workflow.attempts || [])];
    const index = attempts.findIndex((item) => item.attemptId === attempt.attemptId);
    const sanitizedAttempt = { ...attempt, components: this.publicComponents(attempt.components) };
    if (index >= 0) {
      const existing = attempts[index];
      attempts[index] = ['accepted', 'rejected', 'failed'].includes(existing.status)
        ? existing
        : { ...existing, ...sanitizedAttempt };
    } else {
      attempts.push(sanitizedAttempt);
    }
    const nextWorkflow = { ...workflow, attempts };
    if (correctionRunId) {
      message = await this.messageModel.findOneAndUpdate({ _id: messageId, 'correctionWorkflow.correctionRunId': correctionRunId }, { $set: { correctionWorkflow: nextWorkflow } }, { new: true });
      if (!message) throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Correction run ownership lost');
    } else {
      message.correctionWorkflow = nextWorkflow;
      await message.save();
    }
    const response = this.mapToResponse(message);
    await this.broadcastMessage(message.conversationId.toString(), {
      type: 'message_updated',
      data: {
        conversationId: message.conversationId.toString(),
        messageId,
        message: { correctionWorkflow: response.correctionWorkflow } as Partial<MessageResponse>,
      },
    });
    return response;
  }

  async markStaleReliabilityEvaluationsFailed(cutoff: Date): Promise<number> {
    const staleQuery = {
      'reliabilityEvaluation.status': 'pending',
      $or: [
        { reliabilityEvaluationHeartbeatAt: { $lt: cutoff } },
        {
          reliabilityEvaluationHeartbeatAt: { $exists: false },
          'reliabilityEvaluation.requestedAt': { $lt: cutoff.toISOString() },
        },
      ],
    };
    const candidates = await this.messageModel.find(staleQuery).select('_id').lean().exec();
    let updatedCount = 0;
    for (const candidate of candidates) {
      // Reapply the stale predicate atomically so a fresh heartbeat or completed job wins the race.
      const message = await this.messageModel.findOneAndUpdate(
        { _id: candidate._id, ...staleQuery },
        {
          $set: {
            'reliabilityEvaluation.status': 'failed',
            'reliabilityEvaluation.failureCode': 'stale_pending_after_restart',
            'reliabilityEvaluation.evaluatedAt': new Date().toISOString(),
          },
          $unset: { reliabilityEvaluationHeartbeatAt: 1 },
        },
        { new: true },
      );
      if (!message) continue;
      const response = this.mapToResponse(message);
      await this.broadcastMessage(message.conversationId.toString(), {
        type: 'message_updated',
        data: {
          conversationId: message.conversationId.toString(),
          messageId: message._id.toString(),
          message: { reliabilityEvaluation: response.reliabilityEvaluation } as Partial<MessageResponse>,
        },
      });
      updatedCount += 1;
    }
    return updatedCount;
  }

  async touchPendingReliabilityEvaluations(messageIds: string[]): Promise<void> {
    if (!messageIds.length) return;
    await this.messageModel.updateMany(
      {
        _id: { $in: messageIds },
        'reliabilityEvaluation.status': 'pending',
      },
      { $set: { reliabilityEvaluationHeartbeatAt: new Date() } },
    );
  }

  async getMessageDocument(messageId: string): Promise<MessageDocument> {
    const message = await this.messageModel.findById(messageId);

    if (!message) {
      throw new NotFoundException(
        ErrorCode.CHAT_MESSAGE_NOT_FOUND,
        'Message not found',
      );
    }

    return message;
  }

  async findAllByConversation(conversationId: string): Promise<MessageDocument[]> {
    return this.messageModel
      .find({ conversationId: new Types.ObjectId(conversationId) })
      .sort({ createdAt: 1 })
      .lean()
      .exec() as Promise<MessageDocument[]>;
  }

  async markStreamFailed(messageId: string, streamExecutionLeaseId?: string): Promise<void> {
    const update = { isStreaming: false, isComplete: false };
    if (streamExecutionLeaseId) {
      await this.messageModel.findOneAndUpdate({
        _id: new Types.ObjectId(messageId),
        streamExecutionLeaseId,
        isComplete: { $ne: true },
      }, update);
      return;
    }
    await this.messageModel.findByIdAndUpdate(messageId, update);
  }

  async cleanupStaleStreams(olderThanMinutes: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
    const result = await this.messageModel.updateMany(
      { isStreaming: true, updatedAt: { $lt: cutoff } },
      { isStreaming: false, isComplete: false },
    );
    return result.modifiedCount;
  }

  async updateUserMessage(messageId: string, content: string, agentIds?: string[], memberIds?: string[]): Promise<MessageResponse> {
    const message = await this.messageModel.findById(messageId);

    if (!message) {
      throw new NotFoundException(
        ErrorCode.CHAT_MESSAGE_NOT_FOUND,
        'Message not found',
      );
    }

    if (message.conversationType !== 'user') {
      throw new AppException({
        code: ErrorCode.CHAT_INVALID_FEEDBACK,
        message: 'Only user messages can be edited',
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }

    message.content = content;
    message.isEdited = true;
    message.editedAt = new Date();
    if (agentIds !== undefined) {
      message.agentIds = agentIds.map((id) => new Types.ObjectId(id));
      // Persist tagged agents for group conversations (roster only; sticky owned by sendMessage)
      if (agentIds.length > 0) {
        await this.conversationService.updateTaggedAgents(
          message.conversationId.toString(),
          agentIds,
        );
      }
    }
    if (memberIds !== undefined) {
      message.memberIds = memberIds.map((id) => new Types.ObjectId(id));
    }
    await message.save();

    this.logger.log('User message updated', { messageId });

    const response = this.mapToResponse(message);

    // Broadcast update
    this.broadcastMessage(message.conversationId.toString(), {
      type: 'message_updated',
      data: {
        conversationId: message.conversationId.toString(),
        messageId,
        message: response,
      },
    });

    return response;
  }

  async deleteByConversation(conversationId: string): Promise<number> {
    const result = await this.messageModel.deleteMany({
      conversationId: new Types.ObjectId(conversationId),
    });
    return result.deletedCount;
  }

  async findBranchesByQuestion(questionMessageId: string): Promise<MessageResponse[]> {
    const messages = await this.messageModel
      .find({
        questionMessageId: new Types.ObjectId(questionMessageId),
        conversationType: 'ai',
      })
      .sort({ createdAt: 1 })
      .lean()
      .exec();

    return messages.map((m) => this.mapToResponse(m));
  }

  /**
   * Resolve attached file IDs to AttachedFileResponse objects with presigned download URLs.
   * Returns a Map for efficient lookup.
   */
  private async resolveAttachedFiles(fileIds: string[]): Promise<Map<string, AttachedFileResponse>> {
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

  private mapToResponse(message: MessageDocument | Record<string, any>): MessageResponse {
    const toStr = (v: any) => v?.toString?.() ?? v;
    const toISO = (v: any) => (v instanceof Date ? v.toISOString() : v);
    return {
      id: toStr(message._id),
      conversationId: toStr(message.conversationId),
      conversationType: message.conversationType as 'user' | 'ai',
      content: message.content,
      components: this.publicComponents(message.components, true) as any,
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
      requestId: message.requestId,
      guardrailDecision: message.guardrailDecision as any,
      interaction: message.interaction as Record<string, unknown> | undefined,
      interactions: message.interactions as Record<string, unknown>[] | undefined,
      reliabilityEvaluation: message.reliabilityEvaluation as ReliabilityEvaluation | undefined,
      correctionWorkflow: message.correctionWorkflow ? {
        ...message.correctionWorkflow,
        ...(message.correctionWorkflow.correctedComponents ? {
          correctedComponents: this.publicComponents(message.correctionWorkflow.correctedComponents),
        } : {}),
        ...(message.correctionWorkflow.attempts ? {
          attempts: message.correctionWorkflow.attempts.map((attempt: ResponseCorrectionAttempt) => ({
            ...attempt,
            components: this.publicComponents(attempt.components),
          })),
        } : {}),
      } as MessageResponse['correctionWorkflow'] : undefined,
      agentIds: message.agentIds?.map((id: any) => toStr(id)),
      memberIds: message.memberIds?.map((id: any) => toStr(id)),
      senderId: toStr(message.senderId),
      parentMessageId: toStr(message.parentMessageId),
      createdAt: toISO(message.createdAt),
      updatedAt: toISO(message.updatedAt),
    };
  }

  private publicComponents(components: unknown, includeToolResults = false): MessageComponent[] | undefined {
    if (!Array.isArray(components)) return undefined;
    return components.map((component) => {
      if (component?.type === 'task' && component.data) {
        return {
          id: component.id,
          type: component.type,
          data: { ...component.data, items: sanitizeTaskDiagnosticItems(component.data.items) },
        };
      }
      if (component?.type !== 'toolInfo' || !component.data) return component;
      if (includeToolResults) {
        return sanitizePublicComponent({ id: component.id, type: component.type, data: { ...component.data } });
      }
      const { resultJson: _resultJson, result_json: _resultJsonSnake, ...publicData } = component.data;
      return sanitizePublicComponent({ id: component.id, type: component.type, data: publicData });
    });
  }

  private findGuardrailDecision(components: MessageComponent[]): CompleteAIMessageData['guardrailDecision'] {
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
