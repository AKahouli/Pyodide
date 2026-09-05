import { Inject, Injectable } from '@nestjs/common';
import { UserService, type UserSummary } from '../../user/user.service';
import { LoggerService } from '../../logger';
import { ConflictException, NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import type {
  CreateReportData,
  PaginatedReports,
  ReportDetailResponse,
  ReportQueryParams,
  ReportResponse,
  ReportStatus,
} from '../interfaces/report.interface';
import {
  MESSAGE_STORE,
  type MessageStore,
  type ReportMessageRecord,
} from '../persistence/message-store';
import { REPORT_STORE, type ReportRecord, type ReportStore } from '../persistence/report-store';

@Injectable()
export class ReportService {
  constructor(
    @Inject(REPORT_STORE) private readonly reportStore: ReportStore,
    @Inject(MESSAGE_STORE) private readonly messageStore: MessageStore,
    private readonly userService: UserService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('ReportService');
  }

  async createReport(data: CreateReportData): Promise<ReportResponse> {
    const existing = await this.reportStore.findByUserAndMessage(data.userId, data.messageId);
    if (existing) {
      throw new ConflictException(
        ErrorCode.CHAT_REPORT_DUPLICATE,
        'You have already reported this message',
      );
    }
    const report = await this.reportStore.create({ ...data, source: 'user' });
    this.logger.log('Report created', {
      reportId: report.id,
      messageId: data.messageId,
      userId: data.userId,
      reason: data.reason,
    });
    return this.mapToResponse(report);
  }

  async createSystemCorrectionReport(
    data: Pick<CreateReportData, 'conversationId' | 'messageId' | 'userId'>,
  ): Promise<ReportResponse> {
    const existing = await this.reportStore.findSystemCorrectionByMessage(data.messageId);
    if (existing) return this.mapToResponse(existing);
    try {
      const report = await this.reportStore.create({
        ...data,
        reason: 'hallucination',
        description: 'Automatic reliability correction requires human review.',
        source: 'system_correction',
      });
      return this.mapToResponse(report);
    } catch (error) {
      const duplicate = await this.reportStore.findByUserAndMessage(data.userId, data.messageId);
      if (duplicate) return this.mapToResponse(duplicate);
      throw error;
    }
  }

  async findAll(params: ReportQueryParams): Promise<PaginatedReports> {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const { records, total } = await this.reportStore.list({
      page,
      limit,
      status: params.status,
      reason: params.reason,
      sortOrder: params.sortOrder ?? 'desc',
    });
    return {
      reports: records.map((report) => this.mapToResponse(report)),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async updateStatus(
    reportId: string,
    status: ReportStatus,
    adminNotes?: string,
  ): Promise<ReportResponse> {
    const report = await this.reportStore.updateStatus(reportId, status, adminNotes);
    if (!report) {
      throw new NotFoundException(ErrorCode.CHAT_REPORT_NOT_FOUND, 'Report not found');
    }
    this.logger.log('Report status updated', { reportId, status });
    return this.mapToResponse(report);
  }

  async findById(reportId: string): Promise<ReportDetailResponse> {
    const report = await this.reportStore.findById(reportId);
    if (!report) {
      throw new NotFoundException(ErrorCode.CHAT_REPORT_NOT_FOUND, 'Report not found');
    }
    const reporter = await this.userService.findSummaryById(report.userId);
    if (!reporter) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND, 'Reporter not found');
    }
    const reportedMessage = await this.requireMessage(
      report.messageId,
      'Reported message not found',
    );
    const [userMessage, aiMessage] = await this.resolveMessagePair(reportedMessage);
    return this.mapToDetailResponse(report, userMessage, aiMessage, reporter);
  }

  private async resolveMessagePair(
    reportedMessage: ReportMessageRecord,
  ): Promise<[ReportMessageRecord, ReportMessageRecord]> {
    if (reportedMessage.conversationType === 'user') {
      const aiMessage = await this.requireMessage(
        reportedMessage.answerMessageId,
        'AI response message not found',
      );
      return [reportedMessage, aiMessage];
    }
    const userMessage = await this.requireMessage(
      reportedMessage.questionMessageId,
      'User question message not found',
    );
    return [userMessage, reportedMessage];
  }

  private async requireMessage(messageId: string | undefined, message: string) {
    const record = messageId ? await this.messageStore.findReportMessageById(messageId) : null;
    if (!record) throw new NotFoundException(ErrorCode.CHAT_MESSAGE_NOT_FOUND, message);
    return record;
  }

  private mapToDetailResponse(
    report: ReportRecord,
    userMessage: ReportMessageRecord,
    aiMessage: ReportMessageRecord,
    reporter: UserSummary,
  ): ReportDetailResponse {
    return {
      ...this.mapToResponse(report),
      userMessage: {
        id: userMessage.id,
        content: userMessage.content,
        attachedFileIds: userMessage.attachedFileIds,
        createdAt: userMessage.createdAt.toISOString(),
      },
      aiMessage: {
        id: aiMessage.id,
        components: aiMessage.components,
        requestId: aiMessage.requestId,
        inputTokens: aiMessage.inputTokens,
        outputTokens: aiMessage.outputTokens,
        durationMs: aiMessage.durationMs,
        isComplete: aiMessage.isComplete,
        createdAt: aiMessage.createdAt.toISOString(),
        reliabilityEvaluation: aiMessage.reliabilityEvaluation,
        correctionWorkflow: aiMessage.correctionWorkflow,
      },
      reporter,
    };
  }

  private mapToResponse(report: ReportRecord): ReportResponse {
    return {
      id: report.id,
      conversationId: report.conversationId,
      messageId: report.messageId,
      userId: report.userId,
      reason: report.reason,
      description: report.description,
      status: report.status,
      adminNotes: report.adminNotes,
      source: report.source,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
    };
  }
}
