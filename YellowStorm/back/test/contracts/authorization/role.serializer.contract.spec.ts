import 'reflect-metadata';
import { AuthorizationService } from '@modules/authorization/authorization.service';
import type { RoleRecord } from '@modules/authorization/persistence/role.store';
import { expectContract } from '../expect-contract';

/** Wire contract for roles built from a PG RoleRecord. */
const record: RoleRecord = {
  id: '64b000000000000000000003',
  name: 'super_admin',
  description: 'Full platform access',
  permissions: ['users.read', 'users.write'],
  isActive: true,
  isSystem: true,
  priority: 100,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-15T00:00:00Z'),
};

describe('role serializer contract', () => {
  it('matches the recorded wire shape', () => {
    const service = Object.create(AuthorizationService.prototype) as unknown as { toRoleResponse(r: unknown): unknown };
    const body = JSON.parse(JSON.stringify(service.toRoleResponse(record))) as Record<string, unknown>;
    expectContract('authorization/role.serializer', body);
    expect(body.id).toBe(record.id);
    expect(body).not.toHaveProperty('_id');
    expect(body).not.toHaveProperty('__v');
  });
});
