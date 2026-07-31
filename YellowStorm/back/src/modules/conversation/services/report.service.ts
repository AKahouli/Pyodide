import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Report, ReportDocument } from '../schemas/report.schema';
import { Message, MessageDocument } from '../schemas/message.schema';
import { User, UserDocument } from '../../user/schemas/user.schema';
import {
  CreateReportData,
  ReportQueryParams,
  ReportResponse,
  PaginatedReports,
  ReportStatus,
  ReportDetailResponse,
} from '../interfaces/report.interface';
import { MessageComponent } from '../interfaces/message.interface';
import { LoggerService } from '../../logger';
import { NotFoundException, ConflictException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';

@Injectable()
export class ReportService {
  constructor(
    @InjectModel(Report.name)
    private readonly reportModel: Model<ReportDocument>,
    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('ReportService');
  }

  async createReport(data: CreateReportData): Promise<ReportResponse> {
    // Check for duplicate
    const existing = await this.reportModel.findOne({
      userId: new Types.ObjectId(data.userId),
      messageId: new Types.ObjectId(data.messageId),
    });

    if (existing) {
      throw new ConflictException(
        ErrorCode.CHAT_REPORT_DUPLICATE,
        'You have already reported this message',
      );
    }

    const report = await this.reportModel.create({
      conversationId: new Types.ObjectId(data.conversationId),
      messageId: new Types.ObjectId(data.messageId),
      userId: new Types.ObjectId(data.userId),
      reason: data.reason,
      description: data.description,
      status: 'pending',
      source: 'user',
    });

    this.logger.log('Report created', {
      reportId: report._id,
      messageId: data.messageId,
      userId: data.userId,
      reason: data.reason,
    });

    return this.mapToResponse(report);
  }

  async createSystemCorrectionReport(data: Pick<CreateReportData, 'conversationId' | 'messageId' | 'userId'>): Promise<ReportResponse> {
    const existing = await this.reportModel.findOne({ messageId: new Types.ObjectId(data.messageId), source: 'system_correction' });
    if (existing) return this.mapToResponse(existing);
    try {
      const report = await this.reportModel.create({
        conversationId: new Types.ObjectId(data.conversationId),
        messageId: new Types.ObjectId(data.messageId),
        userId: new Types.ObjectId(data.userId),
        reason: 'hallucination',
        description: 'Automatic reliability correction requires human review.',
        status: 'pending',
        source: 'system_correction',
      });
      return this.mapToResponse(report);
    } catch (error) {
      // The legacy user/message unique index may already own the row; reuse it rather than duplicate review work.
      const duplicate = await this.reportModel.findOne({ userId: new Types.ObjectId(data.userId), messageId: new Types.ObjectId(data.messageId) });
      if (duplicate) return this.mapToResponse(duplicate);
      throw error;
    }
  }

  async findAll(params: ReportQueryParams): Promise<PaginatedReports> {
    const {
      page = 1,
      limit = 20,
      status,
      reason,
      sortOrder = 'desc',
    } = params;

    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = {};
    if (status) {
      query.status = status;
    }
    if (reason) {
      query.reason = reason;
    }

    const sort: Record<string, 1 | -1> = {
      createdAt: sortOrder === 'asc' ? 1 : -1,
    };

    const [reports, total] = await Promise.all([
      this.reportModel.find(query).sort(sort).skip(skip).limit(limit).exec(),
      this.reportModel.countDocuments(query),
    ]);

    return {
      reports: reports.map((r) => this.mapToResponse(r)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async updateStatus(
    reportId: string,
    status: ReportStatus,
    adminNotes?: string,
  ): Promise<ReportResponse> {
    const report = await this.reportModel.findById(reportId);

    if (!report) {
      throw new NotFoundException(
        ErrorCode.CHAT_REPORT_NOT_FOUND,
        'Report not found',
      );
    }

    report.status = status;
    if (adminNotes !== undefined) {
      report.adminNotes = adminNotes;
    }
    await report.save();

    this.logger.log('Report status updated', {
      reportId,
      status,
    });

    return this.mapToResponse(report);
  }

  async findById(reportId: string): Promise<ReportDetailResponse> {
    const report = await this.reportModel.findById(reportId).exec();

    if (!report) {
      throw new NotFoundException(
        ErrorCode.CHAT_REPORT_NOT_FOUND,
        'Report not found',
      );
    }

    // Get the reporter user
    const reporter = await this.userModel
      .findById(report.userId)
      .select('email')
      .exec();

    if (!reporter) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND, 'Reporter not found');
    }

    // Get the reported message
    const reportedMessage = await this.messageModel
      .findById(report.messageId)
      .exec();

    if (!reportedMessage) {
      throw new NotFoundException(
        ErrorCode.CHAT_MESSAGE_NOT_FOUND,
        'Reported message not found',
      );
    }

    let userMessage: MessageDocument;
    let aiMessage: MessageDocument;

    // Determine if reported message is user or AI, then get the pair
    if (reportedMessage.conversationType === 'user') {
      userMessage = reportedMessage;
      const aiMsg = await this.messageModel
        .findById(reportedMessage.answerMessageId)
        .exec();
      if (!aiMsg) {
        throw new NotFoundException(
          ErrorCode.CHAT_MESSAGE_NOT_FOUND,
          'AI response message not found',
        );
      }
      aiMessage = aiMsg;
    } else {
      aiMessage = reportedMessage;
      const userMsg = await this.messageModel
        .findById(reportedMessage.questionMessageId)
        .exec();
      if (!userMsg) {
        throw new NotFoundException(
          ErrorCode.CHAT_MESSAGE_NOT_FOUND,
          'User question message not found',
        );
      }
      userMessage = userMsg;
    }

    return this.mapToDetailResponse(report, userMessage, aiMessage, reporter);
  }

  private mapToDetailResponse(
    report: ReportDocument,
    userMessage: MessageDocument,
    aiMessage: MessageDocument,
    reporter: UserDocument,
  ): ReportDetailResponse {
    return {
      ...this.mapToResponse(report),
      userMessage: {
        id: userMessage._id.toString(),
        content: userMessage.content || '',
        attachedFileIds: userMessage.attachedFileIds?.map((id) => id.toString()),
        createdAt: userMessage.createdAt.toISOString(),
      },
      aiMessage: {
        id: aiMessage._id.toString(),
        components: (aiMessage.components || []) as MessageComponent[],
        requestId: aiMessage.requestId,
        inputTokens: aiMessage.inputTokens,
        outputTokens: aiMessage.outputTokens,
        durationMs: aiMessage.durationMs,
        isComplete: aiMessage.isComplete,
        createdAt: aiMessage.createdAt.toISOString(),
        reliabilityEvaluation: aiMessage.reliabilityEvaluation,
        correctionWorkflow: aiMessage.correctionWorkflow,
      },
      reporter: {
        id: reporter._id.toString(),
        email: reporter.email,
      },
    };
  }

  private mapToResponse(report: ReportDocument): ReportResponse {
    return {
      id: report._id.toString(),
      conversationId: report.conversationId.toString(),
      messageId: report.messageId.toString(),
      userId: report.userId.toString(),
      reason: report.reason as any,
      description: report.description,
      status: report.status as ReportStatus,
      adminNotes: report.adminNotes,
      source: report.source,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
    };
  }
}
