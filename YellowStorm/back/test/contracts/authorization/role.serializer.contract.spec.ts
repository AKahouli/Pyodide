import 'reflect-metadata';
import { Types } from 'mongoose';
import { RoleSchema } from '@modules/authorization/schemas/role.schema';
import { expectContract, hydrateDoc } from '../expect-contract';


/** Serializer contract for Mongo `roles` — parity gate for the 1A RoleStore mapper. */
const wire = (): Record<string, unknown> =>
  JSON.parse(
    JSON.stringify(
      hydrateDoc(RoleSchema, {
        _id: new Types.ObjectId('64b000000000000000000003'),
        name: 'super_admin',
        description: 'Full platform access',
        permissions: ['users.read', 'users.write'],
        isActive: true,
        isSystem: true,
        priority: 100,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-15T00:00:00Z'),
      }).toJSON(),
    ),
  );

describe('role serializer contract', () => {
  it('matches the recorded Mongo toJSON shape', () => {
    const body = wire();
    expectContract('authorization/role.serializer', body);
    expect(body.id).toBe('64b000000000000000000003');
    expect(body).not.toHaveProperty('_id');
    expect(body).not.toHaveProperty('__v');
  });
});
