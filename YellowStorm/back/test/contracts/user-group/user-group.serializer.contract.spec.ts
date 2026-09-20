import 'reflect-metadata';
import { Types } from 'mongoose';
import { UserGroupSchema } from '@modules/user-group/schemas/user-group.schema';
import { expectContract, hydrateDoc } from '../expect-contract';


/** Serializer contract for Mongo `user_groups` — parity gate for the 1A UserGroupStore mapper. */
const wire = (): Record<string, unknown> =>
  JSON.parse(
    JSON.stringify(
      hydrateDoc(UserGroupSchema, {
        _id: new Types.ObjectId('64b000000000000000000030'),
        name: 'platform-team',
        description: 'Platform engineers',
        members: [
          new Types.ObjectId('64b000000000000000000001'),
          new Types.ObjectId('64b000000000000000000004'),
        ],
        createdBy: new Types.ObjectId('64b000000000000000000001'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-15T00:00:00Z'),
      }).toJSON(),
    ),
  );

describe('user-group serializer contract', () => {
  it('matches the recorded Mongo toJSON shape', () => {
    const body = wire();
    expectContract('user-group/user-group.serializer', body);
    expect(body.id).toBe('64b000000000000000000030');
    expect(body).not.toHaveProperty('_id');
    expect(body).not.toHaveProperty('__v');
  });
});
