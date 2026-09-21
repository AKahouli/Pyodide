import 'reflect-metadata';
import { AuditLogService } from '@modules/authorization/services/audit-log.service';
import type { AuditLogRecord } from '@modules/authorization/persistence/audit-log.store';
import { expectContract } from '../expect-contract';

/** Wire contract for audit logs built from a PG AuditLogRecord. */
const record: AuditLogRecord = {
  id: '64b000000000000000000020',
  actorId: '64b000000000000000000001',
  actorEmail: 'jane.doe@example.com',
  action: 'auth.login',
  targetId: '64b000000000000000000002',
  targetType: 'user',
  metadata: { method: 'password' },
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
  status: 'success',
  failureReason: null,
  createdAt: new Date('2026-01-15T00:00:00Z'),
};

const wire = (r: AuditLogRecord): Record<string, unknown> => {
  const service = Object.create(AuditLogService.prototype) as unknown as { toAuditLogResponse(r: unknown): unknown };
  return JSON.parse(JSON.stringify(service.toAuditLogResponse(r)));
};

describe('audit-log serializer contract', () => {
  it('matches the recorded wire shape', () => {
    const body = wire(record);
    expectContract('authorization/audit-log.serializer', body);
    expect(body.id).toBe(record.id);
    expect(body).not.toHaveProperty('_id');
    expect(body).not.toHaveProperty('__v');
  });

  it('omits null optional columns instead of emitting nulls', () => {
    const body = wire({ ...record, targetId: null, targetType: null, metadata: null, ipAddress: null, userAgent: null });
    for (const key of ['targetId', 'targetType', 'metadata', 'ipAddress', 'userAgent', 'failureReason']) {
      expect(body).not.toHaveProperty(key);
    }
  });
});
