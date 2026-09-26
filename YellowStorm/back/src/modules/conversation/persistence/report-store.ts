import type { ReportQueryParams, ReportReason, ReportStatus } from '../interfaces/report.interface';


export interface ReportRecord {
  id: string;
  conversationId: string;
  messageId: string;
  userId: string;
  reason: ReportReason;
  description: string;
  status: ReportStatus;
  adminNotes?: string;
  source: 'user' | 'system_correction';
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateReportRecord {
  conversationId: string;
  messageId: string;
  userId: string;
  reason: ReportReason;
  description: string;
  source: 'user' | 'system_correction';
}

export interface ReportStore {
  findByUserAndMessage(userId: string, messageId: string): Promise<ReportRecord | null>;
  findSystemCorrectionByMessage(messageId: string): Promise<ReportRecord | null>;
  create(input: CreateReportRecord): Promise<ReportRecord>;
  list(
    params: Required<Pick<ReportQueryParams, 'page' | 'limit' | 'sortOrder'>> &
      Pick<ReportQueryParams, 'status' | 'reason'>,
  ): Promise<{ records: ReportRecord[]; total: number }>;
  updateStatus(
    reportId: string,
    status: ReportStatus,
    adminNotes?: string,
  ): Promise<ReportRecord | null>;
  findById(reportId: string): Promise<ReportRecord | null>;
}
