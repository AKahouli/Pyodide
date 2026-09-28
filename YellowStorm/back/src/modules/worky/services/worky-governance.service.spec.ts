import { newObjectId } from '@common/postgres';
import { WorkyGovernanceService } from './worky-governance.service';
import type { WorkyGovernancePolicyInput } from '../persistence/worky-governance.repository';
import type { WorkyGovernancePolicyRecord, WorkyStreamRecord } from '../worky.types';

/** In-memory stand-ins for the stream and governance repositories. */
function buildService() {
  const streamRows = new Map<string, WorkyStreamRecord>();
  const policyRows = new Map<string, WorkyGovernancePolicyRecord>();
  const streams = {
    findById: jest.fn(async (id: string) => streamRows.get(id) ?? null),
  };
  const policies = {
    findWorkspacePolicy: jest.fn(async (workspaceId: string) => policyRows.get(workspaceId) ?? null),
    upsertWorkspacePolicy: jest.fn(async (input: WorkyGovernancePolicyInput) => {
      const existing = policyRows.get(input.workspaceId);
      const row: WorkyGovernancePolicyRecord = {
        id: existing?.id ?? newObjectId(),
        scope: 'workspace',
        createdAt: existing?.createdAt ?? new Date(),
        updatedAt: new Date(),
        ...input,
      };
      policyRows.set(input.workspaceId, row);
      return row;
    }),
  };
  const events = { emit: jest.fn() };
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const service = new WorkyGovernanceService(
    streams as never,
    policies as never,
    events as never,
    audit as never,
    { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as never,
  );
  const seedStream = (workspaceId = newObjectId()): WorkyStreamRecord => {
    const stream = { id: newObjectId(), ownerUserId: newObjectId(), workspaceId } as WorkyStreamRecord;
    streamRows.set(stream.id, stream);
    return stream;
  };
  const seedPolicy = (workspaceId: string, over: Partial<WorkyGovernancePolicyInput> = {}) =>
    policies.upsertWorkspacePolicy({
      workspaceId,
      defaultLevel: 'notify',
      categories: [],
      allowStreamOwnerOverride: true,
      maxOwnerRelaxLevel: 'notify',
      ...over,
    });
  return { service, streams, policies, events, audit, seedStream, seedPolicy };
}

describe('WorkyGovernanceService', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('resolves internal_analysis to off when no policy is set (default)', async () => {
    const stream = ctx.seedStream();
    const result = await ctx.service.resolve(stream.id, 'internal_analysis', null);
    expect(result.resolvedLevel).toBe('off');
    expect(result.source).toBe('default');
    expect(ctx.policies.findWorkspacePolicy).toHaveBeenCalledWith(stream.workspaceId);
    expect(ctx.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ streamId: stream.id, action: 'governance.evaluated', targetId: stream.id }),
    );
    expect(ctx.events.emit).toHaveBeenCalledWith(
      stream.ownerUserId,
      stream.id,
      expect.objectContaining({ type: 'governance.evaluated' }),
    );
  });

  it('resolves external_send to approval by default (external category)', async () => {
    const stream = ctx.seedStream();
    const result = await ctx.service.resolve(stream.id, 'external_send', null);
    expect(result.resolvedLevel).toBe('approval');
    expect(result.source).toBe('default');
  });

  it('answers not found for a malformed or unknown stream id', async () => {
    await expect(ctx.service.resolve('nope', 'external_send', null)).rejects.toMatchObject({ code: 'ERR_3500' });
    await expect(ctx.service.resolve(newObjectId(), 'external_send', null)).rejects.toMatchObject({ code: 'ERR_3500' });
    expect(ctx.streams.findById).toHaveBeenCalledTimes(1);
  });

  it('uses workspace policy when present', async () => {
    const workspaceId = newObjectId();
    const stream = ctx.seedStream(workspaceId);
    await ctx.seedPolicy(workspaceId, { categories: [{ category: 'external_send', level: 'hard_block' }] });
    const result = await ctx.service.resolve(stream.id, 'external_send', null);
    expect(result.resolvedLevel).toBe('hard_block');
    expect(result.source).toBe('workspace_policy');
  });

  it('stream override can make a category stricter', async () => {
    const workspaceId = newObjectId();
    const stream = ctx.seedStream(workspaceId);
    await ctx.seedPolicy(workspaceId, { categories: [{ category: 'external_send', level: 'approval' }] });
    const result = await ctx.service.resolve(stream.id, 'external_send', 'hard_block');
    expect(result.resolvedLevel).toBe('hard_block');
    expect(result.source).toBe('stream_override');
  });

  it('stream override to off is rejected', async () => {
    const workspaceId = newObjectId();
    const stream = ctx.seedStream(workspaceId);
    await ctx.seedPolicy(workspaceId);
    await expect(ctx.service.resolve(stream.id, 'external_send', 'off')).rejects.toMatchObject({
      code: 'ERR_3515',
    });
    expect(ctx.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'governance.rejected', details: expect.objectContaining({ reason: 'override_to_off_forbidden' }) }),
    );
  });

  it('stream override below the relax ceiling is rejected', async () => {
    const workspaceId = newObjectId();
    const stream = ctx.seedStream(workspaceId);
    await ctx.seedPolicy(workspaceId, {
      categories: [{ category: 'external_send', level: 'hard_block' }],
      maxOwnerRelaxLevel: 'approval',
    });
    // The owner can only relax to `notify` (rank 1); `off` (rank 0) is rejected.
    await expect(ctx.service.resolve(stream.id, 'external_send', 'off')).rejects.toMatchObject({
      code: 'ERR_3515',
    });
  });

  it('owner override is ignored when allowStreamOwnerOverride is false', async () => {
    const workspaceId = newObjectId();
    const stream = ctx.seedStream(workspaceId);
    await ctx.seedPolicy(workspaceId, {
      categories: [{ category: 'external_send', level: 'approval' }],
      allowStreamOwnerOverride: false,
    });
    const result = await ctx.service.resolve(stream.id, 'external_send', 'off');
    expect(result.resolvedLevel).toBe('approval');
    expect(result.source).toBe('workspace_policy');
  });

  it('upsertWorkspacePolicy creates a new policy', async () => {
    const workspaceId = newObjectId();
    const actorUserId = newObjectId();
    const policy = await ctx.service.upsertWorkspacePolicy(actorUserId, {
      workspaceId,
      defaultLevel: 'notify',
      categories: [{ category: 'external_send', level: 'hard_block' }],
      allowStreamOwnerOverride: true,
      maxOwnerRelaxLevel: 'approval',
    });
    expect(policy.workspaceId).toBe(workspaceId);
    expect(policy.defaultLevel).toBe('notify');
    expect(policy.categories[0].level).toBe('hard_block');
    expect(ctx.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ streamId: workspaceId, actorUserId, action: 'governance.policy.upserted', targetType: 'workspace' }),
    );
  });

  it('upsertWorkspacePolicy updates an existing policy (idempotent)', async () => {
    const workspaceId = newObjectId();
    const first = await ctx.service.upsertWorkspacePolicy(newObjectId(), {
      workspaceId,
      defaultLevel: 'off',
      categories: [],
      allowStreamOwnerOverride: true,
      maxOwnerRelaxLevel: 'notify',
    });
    const updated = await ctx.service.upsertWorkspacePolicy(newObjectId(), {
      workspaceId,
      defaultLevel: 'notify',
      categories: [{ category: 'external_send', level: 'approval' }],
      allowStreamOwnerOverride: true,
      maxOwnerRelaxLevel: 'notify',
    });
    expect(updated.id).toBe(first.id);
    expect(updated.defaultLevel).toBe('notify');
    expect(updated.categories[0].level).toBe('approval');
    expect(await ctx.service.findPolicy(workspaceId)).toEqual(updated);
  });

  it('upsertWorkspacePolicy drops categories with an unknown level and rejects a malformed workspace id', async () => {
    const workspaceId = newObjectId();
    await ctx.service.upsertWorkspacePolicy(newObjectId(), {
      workspaceId,
      defaultLevel: 'notify',
      categories: [
        { category: 'external_send', level: 'approval' },
        { category: 'research', level: 'bogus' as never },
      ],
      allowStreamOwnerOverride: true,
      maxOwnerRelaxLevel: 'notify',
    });
    expect(ctx.policies.upsertWorkspacePolicy).toHaveBeenCalledWith(
      expect.objectContaining({ categories: [{ category: 'external_send', level: 'approval' }] }),
    );

    await expect(
      ctx.service.upsertWorkspacePolicy(newObjectId(), {
        workspaceId: 'nope',
        defaultLevel: 'notify',
        categories: [],
        allowStreamOwnerOverride: true,
        maxOwnerRelaxLevel: 'notify',
      }),
    ).rejects.toMatchObject({ code: 'ERR_1001' });
  });
});
