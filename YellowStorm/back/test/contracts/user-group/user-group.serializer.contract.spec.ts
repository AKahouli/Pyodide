import 'reflect-metadata';
import { UserGroupService } from '@modules/user-group/user-group.service';
import type { PopulatedGroupRecord } from '@modules/user-group/persistence/user-group.store';
import { expectContract } from '../expect-contract';

/** Wire contract for user groups built from a PG PopulatedGroupRecord. */
const record: PopulatedGroupRecord = {
  id: '64b000000000000000000030',
  name: 'platform-team',
  description: 'Platform engineers',
  createdBy: '64b000000000000000000001',
  members: [
    { id: '64b000000000000000000001', email: 'jane.doe@example.com', firstName: 'Jane', lastName: 'Doe' },
    { id: '64b000000000000000000004', email: 'john@example.com', firstName: null, lastName: null },
  ],
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-15T00:00:00Z'),
};

describe('user-group serializer contract', () => {
  it('matches the recorded wire shape', () => {
    const service = Object.create(UserGroupService.prototype) as unknown as { toResponse(r: unknown): unknown };
    const body = JSON.parse(JSON.stringify(service.toResponse(record))) as Record<string, unknown>;
    expectContract('user-group/user-group.serializer', body);
    expect(body.id).toBe(record.id);
    expect(body.memberCount).toBe(2);
    expect(body).not.toHaveProperty('_id');
    expect(body).not.toHaveProperty('__v');
  });
});
