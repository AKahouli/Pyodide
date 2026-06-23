import { Types } from 'mongoose';
import { WorkyGovernanceService } from './worky-governance.service';

class FakePolicyCollection {
  private readonly docs = new Map<string, any>();

  findOne(filter: Record<string, unknown> = {}): any {
    const exec = async () => {
      for (const doc of this.docs.values()) {
        if (this.matches(doc, filter)) return doc;
      }
      return null;
    };
    return { exec, lean: () => ({ exec }) };
  }

  findOneAndUpdate(filter: Record<string, unknown>, update: Record<string, unknown>): any {
    const exec = async () => {
      let target: any | null = null;
      for (const doc of this.docs.values()) {
        if (this.matches(doc, filter)) {
          target = doc;
          break;
        }
      }
      if (!target) {
        const _id = new Types.ObjectId();
        const fresh: any = {
          _id,
          ...(filter as Record<string, unknown>),
          ...(((update as { $set: Record<string, unknown> }).$set) ?? {}),
        };
        this.docs.set(_id.toString(), fresh);
        return fresh;
      }
      Object.assign(target, ((update as { $set: Record<string, unknown> }).$set) ?? {});
      return target;
    };
    return { exec };
  }

  async create(doc: Record<string, unknown>): Promise<any> {
    const _id = new Types.ObjectId();
    const persisted: any = { ...doc, _id };
    this.docs.set(_id.toString(), persisted);
    return persisted;
  }

  private matches(doc: any, filter: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(filter)) {
      const dv = doc[k];
      if (v && typeof v === 'object' && 'toString' in (v as object) && dv && typeof dv === 'object' && 'toString' in (dv as object)) {
        if ((v as { toString(): string }).toString() !== (dv as { toString(): string }).toString()) return false;
        continue;
      }
      if (dv !== v) return false;
    }
    return true;
  }
}

class FakeStreamCollection {
  private readonly docs = new Map<string, any>();

  findById(id: any): any {
    const doc = this.docs.get(id.toString()) ?? null;
    const exec = async () => doc;
    return { exec, lean: () => ({ exec }) };
  }

  async create(doc: Record<string, unknown>): Promise<any> {
    const _id = (doc._id as Types.ObjectId) ?? new Types.ObjectId();
    const persisted: any = { ...doc, _id };
    this.docs.set(_id.toString(), persisted);
    return persisted;
  }
}

function buildService(policies: FakePolicyCollection) {
  const streams = new FakeStreamCollection();
  const events = { emit: jest.fn() };
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const service = new WorkyGovernanceService(
    streams as never,
    policies as never,
    events as never,
    audit as never,
    { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as never,
  );
  return { service, streams, events, audit };
}

async function seedStream(streams: FakeStreamCollection, overrides: Record<string, unknown> = {}): Promise<string> {
  const id = new Types.ObjectId();
  await streams.create({
    _id: id,
    ownerUserId: new Types.ObjectId(),
    workspaceId: new Types.ObjectId(),
    ...overrides,
  });
  return id.toString();
}

describe('WorkyGovernanceService', () => {
  let policies: FakePolicyCollection;
  let service: ReturnType<typeof buildService>['service'];
  let streams: FakeStreamCollection;
  let events: { emit: jest.Mock };
  let audit: { append: jest.Mock };

  beforeEach(() => {
    policies = new FakePolicyCollection();
    const built = buildService(policies);
    service = built.service;
    streams = built.streams;
    events = built.events;
    audit = built.audit;
  });

  it('resolves internal_analysis to off when no policy is set (default)', async () => {
    const streamId = await seedStream(streams);
    const result = await service.resolve(streamId, 'internal_analysis', null);
    expect(result.resolvedLevel).toBe('off');
    expect(result.source).toBe('default');
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'governance.evaluated' }),
    );
  });

  it('resolves external_send to approval by default (external category)', async () => {
    const streamId = await seedStream(streams);
    const result = await service.resolve(streamId, 'external_send', null);
    expect(result.resolvedLevel).toBe('approval');
    expect(result.source).toBe('default');
  });

  it('uses workspace policy when present', async () => {
    const workspaceId = new Types.ObjectId();
    const streamId = await seedStream(streams, { workspaceId });
    await policies.create({
      workspaceId,
      scope: 'workspace',
      defaultLevel: 'notify',
      categories: [{ category: 'external_send', level: 'hard_block' }],
      allowStreamOwnerOverride: true,
      maxOwnerRelaxLevel: 'notify',
    });
    const result = await service.resolve(streamId, 'external_send', null);
    expect(result.resolvedLevel).toBe('hard_block');
    expect(result.source).toBe('workspace_policy');
  });

  it('stream override can make a category stricter', async () => {
    const workspaceId = new Types.ObjectId();
    const streamId = await seedStream(streams, { workspaceId });
    await policies.create({
      workspaceId,
      scope: 'workspace',
      defaultLevel: 'notify',
      categories: [{ category: 'external_send', level: 'approval' }],
      allowStreamOwnerOverride: true,
      maxOwnerRelaxLevel: 'notify',
    });
    const result = await service.resolve(streamId, 'external_send', 'hard_block');
    expect(result.resolvedLevel).toBe('hard_block');
    expect(result.source).toBe('stream_override');
  });

  it('stream override to off is rejected', async () => {
    const workspaceId = new Types.ObjectId();
    const streamId = await seedStream(streams, { workspaceId });
    await policies.create({
      workspaceId,
      scope: 'workspace',
      defaultLevel: 'notify',
      categories: [],
      allowStreamOwnerOverride: true,
      maxOwnerRelaxLevel: 'notify',
    });
    await expect(service.resolve(streamId, 'external_send', 'off')).rejects.toMatchObject({
      code: 'ERR_3515',
    });
  });

  it('stream override below the relax ceiling is rejected', async () => {
    const workspaceId = new Types.ObjectId();
    const streamId = await seedStream(streams, { workspaceId });
    await policies.create({
      workspaceId,
      scope: 'workspace',
      defaultLevel: 'notify',
      categories: [{ category: 'external_send', level: 'hard_block' }],
      allowStreamOwnerOverride: true,
      maxOwnerRelaxLevel: 'approval',
    });
    // The owner can only relax to `notify` (rank 1); `off` (rank 0) is rejected.
    await expect(service.resolve(streamId, 'external_send', 'off')).rejects.toMatchObject({
      code: 'ERR_3515',
    });
  });

  it('owner override is ignored when allowStreamOwnerOverride is false', async () => {
    const workspaceId = new Types.ObjectId();
    const streamId = await seedStream(streams, { workspaceId });
    await policies.create({
      workspaceId,
      scope: 'workspace',
      defaultLevel: 'notify',
      categories: [{ category: 'external_send', level: 'approval' }],
      allowStreamOwnerOverride: false,
      maxOwnerRelaxLevel: 'notify',
    });
    const result = await service.resolve(streamId, 'external_send', 'off');
    expect(result.resolvedLevel).toBe('approval');
    expect(result.source).toBe('workspace_policy');
  });

  it('upsertWorkspacePolicy creates a new policy', async () => {
    const workspaceId = new Types.ObjectId().toString();
    const policy = await service.upsertWorkspacePolicy('user-1', {
      workspaceId,
      defaultLevel: 'notify',
      categories: [{ category: 'external_send', level: 'hard_block' }],
      allowStreamOwnerOverride: true,
      maxOwnerRelaxLevel: 'approval',
    });
    expect(policy.workspaceId.toString()).toBe(workspaceId);
    expect(policy.defaultLevel).toBe('notify');
    expect(policy.categories[0].level).toBe('hard_block');
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'governance.policy.upserted' }),
    );
  });

  it('upsertWorkspacePolicy updates an existing policy (idempotent)', async () => {
    const workspaceId = new Types.ObjectId().toString();
    await service.upsertWorkspacePolicy('user-1', {
      workspaceId,
      defaultLevel: 'off',
      categories: [],
      allowStreamOwnerOverride: true,
      maxOwnerRelaxLevel: 'notify',
    });
    const updated = await service.upsertWorkspacePolicy('user-1', {
      workspaceId,
      defaultLevel: 'notify',
      categories: [{ category: 'external_send', level: 'approval' }],
      allowStreamOwnerOverride: true,
      maxOwnerRelaxLevel: 'notify',
    });
    expect(updated.defaultLevel).toBe('notify');
    expect(updated.categories[0].level).toBe('approval');
  });
});
