/** Row shape of authz.audit_logs. */
export interface AuditLogRecord {
  id: string;
  actorId: string;
  actorEmail: string;
  action: string;
  targetId: string | null;
  targetType: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  status: 'success' | 'failure';
  failureReason: string | null;
  createdAt: Date;
}

export interface AuditLogQuery {
  actorId?: string;
  actorEmail?: string;
  action?: string;
  /** Action namespace prefix ("users" matches "users.suspend"). */
  feature?: string;
  targetId?: string;
  targetType?: string;
  status?: 'success' | 'failure';
  startDate?: Date;
  endDate?: Date;
  skip?: number;
  limit?: number;
}

export const AUDIT_LOG_STORE = Symbol('AUDIT_LOG_STORE');

export interface AuditLogStore {
  insert(record: Omit<AuditLogRecord, 'id' | 'createdAt'>): Promise<void>;
  findAll(query: AuditLogQuery): Promise<{ logs: AuditLogRecord[]; total: number; hasMore: boolean }>;
  getDistinctActions(): Promise<string[]>;
}
