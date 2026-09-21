
export type AuditLogStatus = 'success' | 'failure';

export interface IAuditLog {
  _id: string;
  actorId: string;
  actorEmail: string;
  action: string;
  targetId?: string;
  targetType?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  status: AuditLogStatus;
  failureReason?: string;
  createdAt: Date;
}

export interface AuditLogResponse {
  id: string;
  actorId: string;
  actorEmail: string;
  action: string;
  targetId?: string;
  targetType?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  status: AuditLogStatus;
  failureReason?: string;
  createdAt: Date;
}

export interface CreateAuditLogParams {
  actorId: string;
  actorEmail: string;
  action: string;
  targetId?: string;
  targetType?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  status: AuditLogStatus;
  failureReason?: string;
}

export interface AuditLogQueryParams {
  actorId?: string;
  actorEmail?: string;
  action?: string;
  feature?: string;
  targetType?: string;
  status?: AuditLogStatus;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  skip?: number;
}
