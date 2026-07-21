import { model, models, Types } from 'mongoose';
import { GovernanceWorkspaceBindingSchema } from './governance-workspace-binding.schema';

describe('GovernanceWorkspaceBindingSchema', () => {
  it('serializes Mongo _id as the public id contract', () => {
    const Model = models.GovernanceWorkspaceBindingSerializationTest
      ?? model('GovernanceWorkspaceBindingSerializationTest', GovernanceWorkspaceBindingSchema.clone());
    const id = new Types.ObjectId();
    const document = new Model({
      _id: id,
      programId: new Types.ObjectId(),
      workspaceId: new Types.ObjectId(),
      visibility: 'scope_specific',
      scopeIds: [new Types.ObjectId()],
      createdBy: new Types.ObjectId(),
    });

    const serialized = document.toJSON() as Record<string, unknown>;

    expect(serialized.id).toBe(id.toString());
    expect(serialized).not.toHaveProperty('_id');
    expect(serialized).not.toHaveProperty('__v');
  });
});
