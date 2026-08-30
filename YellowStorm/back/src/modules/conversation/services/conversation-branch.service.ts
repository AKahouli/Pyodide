import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash, randomUUID } from 'node:crypto';
import { BranchConversationDto } from '../dto/branch-conversation.dto';
import { ConversationResponse } from '../interfaces/conversation.interface';
import { ConversationService } from './conversation.service';
import { ConversationHistoryEntry, StreamService } from './stream.service';
import { AppException } from '../../exceptions/exceptions/base.exception';
import { BadRequestException, ConflictException, NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { LoggerService } from '../../logger';
import {
  CONVERSATION_BRANCH_STORE,
  type BranchStateRecord,
  type ConversationBranchStore,
} from '../persistence/conversation-branch-store';
import {
  CONVERSATION_STORE,
  type ConversationRecord,
  type ConversationStore,
} from '../persistence/conversation-store';
import { MESSAGE_STORE, type MessageRecord, type MessageStore } from '../persistence/message-store';

const MAX_BRANCH_SELECTIONS = 500;

export interface CanonicalConversationPath {
  source: ConversationRecord;
  messages: MessageRecord[];
  path: MessageRecord[];
  selectedAnswerIds: string[];
  fingerprint: string;
}

@Injectable()
export class ConversationBranchService {
  constructor(
    @Inject(CONVERSATION_BRANCH_STORE) private readonly branchStore: ConversationBranchStore,
    @Inject(CONVERSATION_STORE) private readonly conversationStore: ConversationStore,
    @Inject(MESSAGE_STORE) private readonly messageStore: MessageStore,
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
    const source = await this.conversationStore.findById(sourceConversationId);
    if (!source || source.createdBy !== userId) {
      throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Conversation not found');
    }
    if (source.isGroup || source.runtimeMode === 'governed') {
      throw new ConflictException(
        ErrorCode.CHAT_BRANCH_UNSUPPORTED,
        'Group and governed conversations cannot be branched',
      );
    }
    const requestFingerprint = this.requestFingerprint(dto);
    let destination = await this.branchStore.findByRequest(userId, dto.requestId);
    if (!destination) {
      const messages = await this.messageStore.listByConversation(source.id);
      const path = this.derivePath(messages, dto);
      const selectedAnswerIds = path
        .filter((message) => message.conversationType === 'ai')
        .map((message) => message.id);
      try {
        destination = await this.branchStore.createPending({
          source,
          path,
          selectedAnswerIds,
          requestId: dto.requestId,
          requestFingerprint,
          targetMessageId: dto.targetMessageId,
          userId,
        });
      } catch (error: unknown) {
        if (!this.isUniqueViolation(error)) throw error;
        destination = await this.branchStore.findByRequest(userId, dto.requestId);
      }
    }
    if (!destination) {
      throw new AppException({
        code: ErrorCode.CHAT_BRANCH_SEED_FAILED,
        message: 'Failed to create the branched conversation',
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      });
    }
    this.assertSameRequest(destination, sourceConversationId, dto, requestFingerprint);
    if (destination.initializationStatus === 'ready') {
      return this.conversationService.findById(destination.id);
    }
    const attemptId = randomUUID();
    if (!(await this.branchStore.claimSeed(destination.id, attemptId))) {
      return this.waitForBranch(destination.id);
    }
    try {
      const messages = await this.messageStore.listByConversation(destination.id);
      await this.streamService.seedConversationSession(
        userId,
        destination.id,
        dto.requestId,
        this.toHistory(messages),
      );
      if (!(await this.branchStore.finalizeSeed(destination.id, attemptId))) {
        throw new Error('Conversation branch initialization lease was lost');
      }
      return this.conversationService.findById(destination.id);
    } catch (error: unknown) {
      await this.compensate(destination.id, userId, dto.requestId, attemptId);
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
    if (!/^[0-9a-f]{24}$/.test(sourceConversationId)) {
      throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Conversation not found');
    }
    const source = await this.conversationStore.findById(sourceConversationId);
    const hasAccess = source &&
      (source.createdBy === userId || source.members.some((member) => member.userId === userId));
    if (!source || !hasAccess) {
      throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Conversation not found');
    }
    if (source.runtimeMode === 'governed') {
      throw new ConflictException(
        ErrorCode.CONFLICT,
        'This governed conversation does not permit derivative use',
      );
    }
    const messages = await this.messageStore.listByConversation(source.id);
    const path = this.derivePath(messages, {
      requestId: 'handoff-resolution',
      targetMessageId,
      activeBranches,
    });
    const selectedAnswerIds = path
      .filter((message) => message.conversationType === 'ai')
      .map((message) => message.id);
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify(
          path.map((message) => ({ id: message.id, updatedAt: message.updatedAt.toISOString() })),
        ),
      )
      .digest('hex');
    return { source, messages, path, selectedAnswerIds, fingerprint };
  }

  private derivePath(messages: MessageRecord[], dto: BranchConversationDto): MessageRecord[] {
    const selections = Object.entries(dto.activeBranches);
    if (selections.length > MAX_BRANCH_SELECTIONS) {
      throw new BadRequestException(ErrorCode.CHAT_BRANCH_INVALID, 'Too many branch selections');
    }
    for (const [questionId, answerId] of selections) {
      if (!/^[0-9a-f]{24}$/.test(questionId) || !/^[0-9a-f]{24}$/.test(answerId)) {
        throw new BadRequestException(ErrorCode.CHAT_BRANCH_INVALID, 'Invalid branch message ID');
      }
    }
    const targetIndex = messages.findIndex((message) => message.id === dto.targetMessageId);
    if (targetIndex < 0) {
      throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, 'Message not found');
    }
    const target = messages[targetIndex];
    if (
      target.conversationType !== 'ai' ||
      !target.isComplete ||
      target.isStreaming ||
      !target.questionMessageId
    ) {
      throw new BadRequestException(
        ErrorCode.CHAT_BRANCH_INVALID,
        'Branch target must be a completed AI response',
      );
    }
    const prefix = messages.slice(0, targetIndex + 1);
    const prefixById = new Map(prefix.map((message) => [message.id, message]));
    for (const [questionId, answerId] of selections) {
      const question = prefixById.get(questionId);
      const answer = prefixById.get(answerId);
      if (
        question?.conversationType !== 'user' ||
        answer?.conversationType !== 'ai' ||
        answer.questionMessageId !== questionId ||
        !answer.isComplete ||
        answer.isStreaming
      ) {
        throw new BadRequestException(ErrorCode.CHAT_BRANCH_INVALID, 'Invalid selected AI response');
      }
    }
    const targetQuestionId = target.questionMessageId;
    if (
      dto.activeBranches[targetQuestionId] &&
      dto.activeBranches[targetQuestionId] !== dto.targetMessageId
    ) {
      throw new BadRequestException(
        ErrorCode.CHAT_BRANCH_INVALID,
        'Target response is not selected',
      );
    }
    const selectedByQuestion = new Map<string, MessageRecord>();
    for (const message of prefix) {
      if (
        message.conversationType === 'ai' &&
        message.isComplete &&
        !message.isStreaming &&
        message.questionMessageId
      ) {
        selectedByQuestion.set(message.questionMessageId, message);
      }
    }
    for (const [questionId, answerId] of selections) {
      selectedByQuestion.set(questionId, prefixById.get(answerId)!);
    }
    selectedByQuestion.set(targetQuestionId, target);
    const path = prefix.filter(
      (message) =>
        message.conversationType === 'user' ||
        selectedByQuestion.get(message.questionMessageId ?? '')?.id === message.id,
    );
    const included = new Set(path.map((message) => message.id));
    if (path.some((message) => message.parentMessageId && !included.has(message.parentMessageId))) {
      throw new BadRequestException(
        ErrorCode.CHAT_BRANCH_INVALID,
        'Selected path contains a reply to an excluded message',
      );
    }
    return path;
  }

  private toHistory(path: MessageRecord[]): ConversationHistoryEntry[] {
    const history: ConversationHistoryEntry[] = [];
    for (const message of path) {
      if (message.conversationType === 'user' && message.content?.trim()) {
        history.push({ role: 'CONVERSATION_HISTORY_ROLE_USER', text: message.content.trim() });
      } else if (message.conversationType === 'ai') {
        const text = (message.components ?? [])
          .filter(
            (component) =>
              component.type === 'text' && typeof component.data?.content === 'string',
          )
          .map((component) => String(component.data.content).trim())
          .filter(Boolean)
          .join('\n\n');
        if (text) history.push({ role: 'CONVERSATION_HISTORY_ROLE_ASSISTANT', text });
      }
    }
    return history;
  }

  private assertSameRequest(
    destination: BranchStateRecord,
    sourceId: string,
    dto: BranchConversationDto,
    fingerprint: string,
  ) {
    if (
      destination.sourceConversationId !== sourceId ||
      destination.sourceTargetMessageId !== dto.targetMessageId ||
      destination.requestFingerprint !== fingerprint ||
      destination.initializationStatus === 'cleanup_pending'
    ) {
      throw new ConflictException(
        ErrorCode.CHAT_BRANCH_INVALID,
        'Branch request ID is already in use',
      );
    }
  }

  private async waitForBranch(id: string): Promise<ConversationResponse> {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const record = await this.conversationStore.findById(id, true);
      if (record?.initializationStatus === 'ready') return this.conversationService.findById(id);
      if (!record || record.initializationStatus === 'cleanup_pending') break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new AppException({
      code: ErrorCode.CHAT_BRANCH_SEED_FAILED,
      message: 'The branched conversation could not be initialized',
      statusCode: HttpStatus.BAD_GATEWAY,
    });
  }

  private async compensate(id: string, userId: string, requestId: string, attemptId: string) {
    if (!(await this.branchStore.ownsSeed(id, attemptId))) return;
    try {
      await this.streamService.deleteConversationSession(userId, id, requestId);
    } catch (error: unknown) {
      await this.branchStore.markCleanup(id, attemptId);
      this.logger.warn('ADK branch cleanup deferred', {
        destinationId: id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return;
    }
    if (await this.branchStore.markCleanup(id, attemptId)) {
      await this.branchStore.deleteCleanup(id);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupStaleBranches(): Promise<void> {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000);
    for (const branch of await this.branchStore.claimStale(cutoff)) {
      try {
        await this.streamService.deleteConversationSession(
          branch.createdBy,
          branch.id,
          branch.requestId,
        );
        await this.branchStore.deleteCleanup(branch.id);
      } catch (error: unknown) {
        this.logger.warn('Stale branch cleanup failed', {
          destinationId: branch.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  private requestFingerprint(dto: BranchConversationDto): string {
    const activeBranches = Object.entries(dto.activeBranches).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return createHash('sha256')
      .update(JSON.stringify({ targetMessageId: dto.targetMessageId, activeBranches }))
      .digest('hex');
  }

  private isUniqueViolation(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');
  }
}
