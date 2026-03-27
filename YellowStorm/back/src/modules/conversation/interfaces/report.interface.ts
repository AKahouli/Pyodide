import { MessageComponent } from './message.interface';

export type ReportReason =
  | 'inaccurate'
  | 'wrong_information'
  | 'offensive'
  | 'out_of_context'
  | 'hallucination'
  | 'other';

export type ReportStatus = 'pending' | 'reviewed' | 'resolved';

export interface CreateReportData {
  conversationId: string;
  messageId: string;
  userId: string;
  reason: ReportReason;
  description: string;
}

export interface ReportQueryParams {
  page?: number;
  limit?: number;
  status?: ReportStatus;
  reason?: ReportReason;
  sortBy?: 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

export interface ReportResponse {
  id: string;
  conversationId: string;
  messageId: string;
  userId: string;
  reason: ReportReason;
  description: string;
  status: ReportStatus;
  adminNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedReports {
  reports: ReportResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ReportDetailResponse extends ReportResponse {
  userMessage: {
    id: string;
    content: string;
    attachedFileIds?: string[];
    createdAt: string;
  };
  aiMessage: {
    id: string;
    components: MessageComponent[];
    requestId?: string;
    inputTokens?: number;
    outputTokens?: number;
    durationMs?: number;
    isComplete: boolean;
    createdAt: string;
  };
  reporter: {
    id: string;
    email: string;
  };
}
