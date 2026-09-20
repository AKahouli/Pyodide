import 'reflect-metadata';
import { Types } from 'mongoose';
import { expectContract, hydrateDoc } from '../expect-contract';
import { AuditLogSchema } from '@modules/authorization/schemas/audit-log.schema';


/** Serializer contract for Mongo `audit_logs` — parity gate for the 1A AuditLogStore mapper. */
const wire = (): Record<string, unknown> =>
  JSON.parse(
    JSON.stringify(
      hydrateDoc(AuditLogSchema, {
        _id: new Types.ObjectId('64b000000000000000000020'),
        actorId: new Types.ObjectId('64b000000000000000000001'),
        actorEmail: 'jane.doe@example.com',
        action: 'auth.login',
        targetId: new Types.ObjectId('64b000000000000000000002'),
        targetType: 'user',
        metadata: { method: 'password' },
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
        status: 'success',
        createdAt: new Date('2026-01-15T00:00:00Z'),
      }).toJSON(),
    ),
  );

describe('audit-log serializer contract', () => {
  it('matches the recorded Mongo toJSON shape', () => {
    const body = wire();
    expectContract('authorization/audit-log.serializer', body);
    expect(body.id).toBe('64b000000000000000000020');
    expect(body).not.toHaveProperty('_id');
    expect(body).not.toHaveProperty('__v');
  });
});
