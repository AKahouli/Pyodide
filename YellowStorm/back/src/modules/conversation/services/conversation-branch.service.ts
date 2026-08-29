import { HttpStatus, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Conversation, ConversationDocument } from '../schemas/conversation.schema';
import { Message, MessageDocument } from '../schemas/message.schema';
import { BranchConversationDto } from '../dto/branch-conversation.dto';
import { ConversationResponse } from '../interfaces/conversation.interface';
import { ConversationService } from './conversation.service';
import { ConversationHistoryEntry, StreamService } from './stream.service';
import { AppException } from '../../exceptions/exceptions/base.exception';
import { BadRequestException, ConflictException, NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { LoggerService } from '../../logger';
import { createHash, randomUUID } from 'node:crypto';

const MAX_BRANCH_SELECTIONS = 500;

export interface CanonicalConversationPath {
  source: any;
  messages: any[];
  path: any[];
  selectedAnswerIds: string[];
  fingerprint: string;
}

@Injectable()
export class ConversationBranchService {
  constructor(
    @InjectModel(Conversation.name) private readonly conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name) private readonly messageModel: Model<MessageDocument>,
    private readonly conversationService: ConversationService,
    private readonly streamService: StreamService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('ConversationBranchService');
  }

  async createBranch(
    sourceConversationId: string,
    userId: string,
    dto: BranchConversationDto,
  ): Promise<ConversationResponse> {
    const source = await this.conversationModel.findOne({
      _id: new Types.ObjectId(sourceConversationId),
      createdBy: new Types.ObjectId(userId),
      initializationStatus: { $nin: ['pending', 'seeding', 'cleanup_pending'] },
    }).lean().exec();

    if (!source) {
      throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Conversation not found');
    }
    if (source.groupMeta?.isGroup || source.runtimeMode === 'governed') {
      throw new ConflictException(
        ErrorCode.CHAT_BRANCH_UNSUPPORTED,
        'Group and governed conversations cannot be branched',
      );
    }

    const requestFingerprint = this.requestFingerprint(dto);
    let destination: any = await this.conversationModel.findOne({
      createdBy: new Types.ObjectId(userId),
      'branchProvenance.requestId': dto.requestId,
    }).exec();

    if (!destination) {
      const sourceMessages = await this.messageModel
        .find({ conversationId: source._id })
        .sort({ createdAt: 1, _id: 1 })
        .lean()
        .exec();
      const path = this.derivePath(sourceMessages, dto);
      const selectedAnswerIds = path
        .filter((message) => message.conversationType === 'ai')
        .map((message) => message._id.toString());
      try {
        destination = await this.createPendingClone(
          source,
          path,
          selectedAnswerIds,
          requestFingerprint,
          userId,
          dto,
        );
      } catch (error) {
        if (!this.isDuplicateKeyError(error)) throw error;
        destination = await this.conversationModel.findOne({
          createdBy: new Types.ObjectId(userId),
          'branchProvenance.requestId': dto.requestId,
        }).exec();
      }
    }
    if (!destination) {
      throw new AppException({
        code: ErrorCode.CHAT_BRANCH_SEED_FAILED,
        message: 'Failed to create the branched conversation',
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      });
    }

    const provenance = destination.branchProvenance;
    const sameRequest = provenance?.sourceConversationId.toString() === sourceConversationId
      && provenance.sourceTargetMessageId.toString() === dto.targetMessageId
      && provenance.requestFingerprint === requestFingerprint;
    if (!sameRequest || destination.initializationStatus === 'cleanup_pending') {
      throw new ConflictException(ErrorCode.CHAT_BRANCH_INVALID, 'Branch request ID is already in use');
    }
    if (destination.initializationStatus === 'ready') {
      return this.conversationService.findById(destination._id.toString());
    }

    const destinationId = destination._id.toString();
    const attemptId = randomUUID();
    const claimed = await this.conversationModel.findOneAndUpdate(
      { _id: destination._id, initializationStatus: 'pending' },
      { $set: { initializationStatus: 'seeding', branchSeedAttemptId: attemptId } },
      { new: true },
    ).exec();
    if (!claimed) {
      return this.waitForBranch(destination._id);
    }

    try {
      const destinationMessages = await this.messageModel
        .find({ conversationId: destination._id })
        .sort({ createdAt: 1, _id: 1 })
        .lean()
        .exec();
      await this.streamService.seedConversationSession(
        userId,
        destinationId,
        dto.requestId,
        this.toHistory(destinationMessages),
      );
      const finalized = await this.conversationModel.updateOne(
        { _id: destination._id, initializationStatus: 'seeding', branchSeedAttemptId: attemptId },
        { $set: { initializationStatus: 'ready' }, $unset: { branchSeedAttemptId: 1 } },
      ).exec();
      if (finalized.modifiedCount !== 1) {
        throw new Error('Conversation branch initialization lease was lost');
      }
      return this.conversationService.findById(destinationId);
    } catch (error) {
      await this.compensate(destination._id, userId, dto.requestId, attemptId);
      this.logger.error('Failed to create conversation branch', {
        sourceConversationId,
        destinationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new AppException({
        code: ErrorCode.CHAT_BRANCH_SEED_FAILED,
        message: 'Failed to initialize the branched conversation',
        statusCode: HttpStatus.BAD_GATEWAY,
        originalError: error instanceof Error ? error : undefined,
      });
    }
  }

  async resolveCanonicalPath(
    sourceConversationId: string,
    userId: string,
    targetMessageId: string,
    activeBranches: Record<string, string>,
  ): Promise<CanonicalConversationPath> {
    if (!Types.ObjectId.isValid(sourceConversationId)) {
      throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Conversation not found');
    }
    const ownerId = new Types.ObjectId(userId);
    const source = await this.conversationModel.findOne({
      _id: new Types.ObjectId(sourceConversationId),
      initializationStatus: { $nin: ['pending', 'seeding', 'cleanup_pending'] },
      $or: [{ createdBy: ownerId }, { 'groupMeta.members.userId': ownerId }],
    }).lean().exec();
    if (!source) throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Conversation not found');
    if (source.runtimeMode === 'governed') {
      throw new ConflictException(ErrorCode.CONFLICT, 'This governed conversation does not permit derivative use');
    }
    const messages = await this.messageModel.find({ conversationId: source._id })
      .sort({ createdAt: 1, _id: 1 }).lean().exec();
    const path = this.derivePath(messages, {
      requestId: 'handoff-resolution',
      targetMessageId,
      activeBranches,
    });
    const selectedAnswerIds = path.filter((message) => message.conversationType === 'ai')
      .map((message) => message._id.toString());
    const fingerprint = createHash('sha256').update(JSON.stringify(path.map((message) => ({
      id: message._id.toString(),
      updatedAt: message.updatedAt instanceof Date ? message.updatedAt.toISOString() : String(message.updatedAt ?? ''),
    })))).digest('hex');
    return { source, messages, path, selectedAnswerIds, fingerprint };
  }

  private derivePath(messages: any[], dto: BranchConversationDto): any[] {
    const selections = Object.entries(dto.activeBranches);
    if (selections.length > MAX_BRANCH_SELECTIONS) {
      throw new BadRequestException(ErrorCode.CHAT_BRANCH_INVALID, 'Too many branch selections');
    }
    for (const [questionId, answerId] of selections) {
      if (!Types.ObjectId.isValid(questionId) || !Types.ObjectId.isValid(answerId)) {
        throw new BadRequestException(ErrorCode.CHAT_BRANCH_INVALID, 'Invalid branch message ID');
      }
    }

    const targetIndex = messages.findIndex((message) => message._id.toString() === dto.targetMessageId);
    if (targetIndex < 0) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Message not found');
    }
    const target = messages[targetIndex];
    if (target.conversationType !== 'ai' || !target.isComplete || target.isStreaming || !target.questionMessageId) {
      throw new BadRequestException(ErrorCode.CHAT_BRANCH_INVALID, 'Branch target must be a completed AI response');
    }

    const prefix = messages.slice(0, targetIndex + 1);
    const prefixById = new Map(prefix.map((message) => [message._id.toString(), message]));
    for (const [questionId, answerId] of selections) {
      const question = prefixById.get(questionId);
      const answer = prefixById.get(answerId);
      if (question?.conversationType !== 'user'
        || answer?.conversationType !== 'ai'
        || answer.questionMessageId?.toString() !== questionId
        || !answer.isComplete
        || answer.isStreaming) {
        throw new BadRequestException(ErrorCode.CHAT_BRANCH_INVALID, 'Invalid selected AI response');
      }
    }

    const targetQuestionId = target.questionMessageId.toString();
    if (dto.activeBranches[targetQuestionId]
      && dto.activeBranches[targetQuestionId] !== dto.targetMessageId) {
      throw new BadRequestException(ErrorCode.CHAT_BRANCH_INVALID, 'Target response is not selected');
    }

    const selectedByQuestion = new Map<string, any>();
    for (const message of prefix) {
      if (message.conversationType === 'ai'
        && message.isComplete
        && !message.isStreaming
        && message.questionMessageId) {
        selectedByQuestion.set(message.questionMessageId.toString(), message);
      }
    }
    for (const [questionId, answerId] of selections) {
      selectedByQuestion.set(questionId, prefixById.get(answerId));
    }
    selectedByQuestion.set(targetQuestionId, target);

    const path = prefix.filter((message) => message.conversationType === 'user'
      || selectedByQuestion.get(message.questionMessageId?.toString())?._id.toString() === message._id.toString());
    const includedIds = new Set(path.map((message) => message._id.toString()));
    const danglingReply = path.find((message) => message.parentMessageId
      && !includedIds.has(message.parentMessageId.toString()));
    if (danglingReply) {
      throw new BadRequestException(ErrorCode.CHAT_BRANCH_INVALID, 'Selected path contains a reply to an excluded message');
    }
    return path;
  }

  private async createPendingClone(
    source: any,
    path: any[],
    selectedAnswerIds: string[],
    requestFingerprint: string,
    userId: string,
    dto: BranchConversationDto,
  ): Promise<any> {
    const destinationId = new Types.ObjectId();
    const idMap = new Map(path.map((message) => [message._id.toString(), new Types.ObjectId()]));
    const now = Date.now();
    const messageDocs = path.map((message, index) => ({
      _id: idMap.get(message._id.toString()),
      conversationId: destinationId,
      senderId: message.conversationType === 'user' ? new Types.ObjectId(userId) : undefined,
      parentMessageId: message.parentMessageId ? idMap.get(message.parentMessageId.toString()) : undefined,
      conversationType: message.conversationType,
      content: message.content,
      components: message.components,
      modelId: message.modelId,
      webSearchEnabled: message.webSearchEnabled,
      questionMessageId: message.questionMessageId ? idMap.get(message.questionMessageId.toString()) : undefined,
      answerMessageId: message.answerMessageId ? idMap.get(message.answerMessageId.toString()) : undefined,
      isEdited: message.isEdited,
      editedAt: message.editedAt,
      isStreaming: false,
      isComplete: true,
      interaction: message.interaction ? {
        ...message.interaction,
        ...(message.interaction.sourceMessageId && idMap.has(message.interaction.sourceMessageId.toString())
          ? { sourceMessageId: idMap.get(message.interaction.sourceMessageId.toString())?.toString() }
          : {}),
      } : undefined,
      agentIds: message.agentIds,
      createdAt: new Date(now + index),
      updatedAt: new Date(now + index),
    }));

    for (const userMessage of messageDocs.filter((message) => message.conversationType === 'user')) {
      const selectedAnswer = messageDocs.find((message) => message.questionMessageId?.equals(userMessage._id!));
      userMessage.answerMessageId = selectedAnswer?._id;
    }

    try {
      const destination = await this.conversationModel.create({
        _id: destinationId,
        title: `${source.title.slice(0, 191)} · Branch`,
        createdBy: new Types.ObjectId(userId),
        messages: messageDocs.map((message) => message._id),
        workspaces: source.workspaces,
        selectedSkills: source.selectedSkills,
        taggedAgentIds: source.taggedAgentIds,
        projectId: source.projectId ?? null,
        lastMessageAt: messageDocs.at(-1)?.createdAt,
        messageCount: messageDocs.length,
        isArchived: false,
        isShared: false,
        isFirstMessage: false,
        initializationStatus: 'pending',
        branchProvenance: {
          sourceConversationId: source._id,
          sourceTargetMessageId: new Types.ObjectId(dto.targetMessageId),
          requestId: dto.requestId,
          requestFingerprint,
          branchedBy: new Types.ObjectId(userId),
          branchedAt: new Date(),
          selectedAnswerIds: selectedAnswerIds.map((id) => new Types.ObjectId(id)),
        },
      });
      await this.messageModel.insertMany(messageDocs);
      return destination;
    } catch (error) {
      await this.cleanupPartialClone(destinationId);
      throw error;
    }
  }

  private toHistory(path: any[]): ConversationHistoryEntry[] {
    const history: ConversationHistoryEntry[] = [];
    for (const message of path) {
      if (message.conversationType === 'user' && message.content?.trim()) {
        history.push({ role: 'CONVERSATION_HISTORY_ROLE_USER', text: message.content.trim() });
        continue;
      }
      if (message.conversationType === 'ai') {
        const text = (message.components ?? [])
          .filter((component: any) => component.type === 'text' && typeof component.data?.content === 'string')
          .map((component: any) => component.data.content.trim())
          .filter(Boolean)
          .join('\n\n');
        if (text) history.push({ role: 'CONVERSATION_HISTORY_ROLE_ASSISTANT', text });
      }
    }
    return history;
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error
      && (error as { code?: number }).code === 11000;
  }

  private requestFingerprint(dto: BranchConversationDto): string {
    const activeBranches = Object.entries(dto.activeBranches)
      .sort(([left], [right]) => left.localeCompare(right));
    return createHash('sha256')
      .update(JSON.stringify({ targetMessageId: dto.targetMessageId, activeBranches }))
      .digest('hex');
  }

  private async waitForBranch(destinationId: Types.ObjectId): Promise<ConversationResponse> {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const branch = await this.conversationModel.findById(destinationId)
        .select('initializationStatus')
        .lean()
        .exec();
      if (branch?.initializationStatus === 'ready') {
        return this.conversationService.findById(destinationId.toString());
      }
      if (!branch || branch.initializationStatus === 'cleanup_pending') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new AppException({
      code: ErrorCode.CHAT_BRANCH_SEED_FAILED,
      message: 'The branched conversation could not be initialized',
      statusCode: HttpStatus.BAD_GATEWAY,
    });
  }

  private async compensate(
    destinationId: Types.ObjectId,
    userId: string,
    idempotencyKey: string,
    attemptId: string,
  ): Promise<void> {
    const ownsAttempt = await this.conversationModel.exists({
      _id: destinationId,
      initializationStatus: 'seeding',
      branchSeedAttemptId: attemptId,
    });
    if (!ownsAttempt) return;

    try {
      await this.streamService.deleteConversationSession(
        userId,
        destinationId.toString(),
        idempotencyKey,
      );
    } catch (error) {
      await this.conversationModel.updateOne(
        { _id: destinationId, initializationStatus: 'seeding', branchSeedAttemptId: attemptId },
        { $set: { initializationStatus: 'cleanup_pending' }, $unset: { branchSeedAttemptId: 1 } },
      ).exec();
      this.logger.warn('ADK branch cleanup deferred', {
        destinationId: destinationId.toString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return;
    }
    await this.deletePendingClone(destinationId, {
      initializationStatus: 'seeding',
      branchSeedAttemptId: attemptId,
    });
  }

  private async deletePendingClone(
    destinationId: Types.ObjectId,
    statusFilter: Record<string, unknown>,
  ): Promise<void> {
    const claimed = await this.conversationModel.findOneAndUpdate(
      { _id: destinationId, ...statusFilter },
      { $set: { initializationStatus: 'cleanup_pending' }, $unset: { branchSeedAttemptId: 1 } },
      { new: true },
    ).select('_id').lean().exec();
    if (!claimed) return;

    await this.messageModel.deleteMany({ conversationId: destinationId }).exec();
    await this.conversationModel.deleteOne({
      _id: destinationId,
      initializationStatus: 'cleanup_pending',
    }).exec();
  }

  private async cleanupPartialClone(destinationId: Types.ObjectId): Promise<void> {
    const results = await Promise.allSettled([
      this.messageModel.deleteMany({ conversationId: destinationId }).exec(),
      this.conversationModel.deleteOne({ _id: destinationId, initializationStatus: 'pending' }).exec(),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.warn('Partial branch clone cleanup failed', {
          destinationId: destinationId.toString(),
          error: result.reason instanceof Error ? result.reason.message : 'Unknown error',
        });
      }
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupStaleBranches(): Promise<void> {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000);
    const stale = await this.conversationModel.find({
      initializationStatus: { $in: ['pending', 'seeding', 'cleanup_pending'] },
      updatedAt: { $lt: cutoff },
    }).select('_id').lean().exec();
    for (const branch of stale) {
      try {
        const claimed = await this.conversationModel.findOneAndUpdate(
          {
            _id: branch._id,
            initializationStatus: { $in: ['pending', 'seeding', 'cleanup_pending'] },
            updatedAt: { $lt: cutoff },
          },
          { $set: { initializationStatus: 'cleanup_pending' }, $unset: { branchSeedAttemptId: 1 } },
          { new: true },
        ).select('_id createdBy branchProvenance.requestId').lean().exec();
        if (!claimed) continue;

        await this.streamService.deleteConversationSession(
          claimed.createdBy.toString(),
          claimed._id.toString(),
          claimed.branchProvenance!.requestId,
        );
        await this.deletePendingClone(claimed._id, {
          initializationStatus: 'cleanup_pending',
        });
      } catch (error) {
        this.logger.warn('Stale branch cleanup failed', {
          destinationId: branch._id.toString(),
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }
}
