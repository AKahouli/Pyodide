import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PlaybookFlowExecutionLeaseService } from './playbook-flow-execution-lease.service';
import { SystemService } from '@modules/system/system.service';
import { DEFAULT_ADMIN_PLAYBOOK_SETTINGS } from '@modules/system/interfaces/playbook-settings.interface';
import { ExecutionLeaseRepository, type ExecutionLeaseSlot } from '../persistence/execution-lease.repository';

describe('PlaybookFlowExecutionLeaseService', () => {
  let service: PlaybookFlowExecutionLeaseService;
  let leases: ExecutionLeaseSlot[];
  let enabled: boolean;
  let leaseRepository: Record<keyof ExecutionLeaseRepository, jest.Mock>;

  const live = (lease: ExecutionLeaseSlot): boolean => lease.expiresAt.getTime() > Date.now();

  beforeEach(async () => {
    leases = [];
    enabled = true;

    // Mirrors the table: unique (scopeKey, slot) and (executionId, scopeType); an expired slot is taken over.
    leaseRepository = {
      claimSlot: jest.fn(async (slot: ExecutionLeaseSlot) => {
        const holder = leases.find((lease) => lease.scopeKey === slot.scopeKey && lease.slot === slot.slot);
        if (holder && live(holder)) return false;
        if (leases.some((lease) => lease !== holder && lease.executionId === slot.executionId && lease.scopeType === slot.scopeType)) return false;
        leases = leases.filter((lease) => lease !== holder);
        leases.push({ ...slot });
        return true;
      }),
      refresh: jest.fn(async (executionId: string, expiresAt: Date) => {
        const held = leases.filter((lease) => lease.executionId === executionId);
        held.forEach((lease) => { lease.expiresAt = expiresAt; });
        return held.length;
      }),
      hasActive: jest.fn(async (executionId: string) => leases.some((lease) => lease.executionId === executionId && live(lease))),
      releaseExecution: jest.fn(async (executionId: string) => {
        const before = leases.length;
        leases = leases.filter((lease) => lease.executionId !== executionId);
        return before - leases.length;
      }),
      deleteExpired: jest.fn(async () => {
        const before = leases.length;
        leases = leases.filter(live);
        return before - leases.length;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybookFlowExecutionLeaseService,
        { provide: ExecutionLeaseRepository, useValue: leaseRepository },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback: unknown) => {
              const values: Record<string, unknown> = {
                'playbook-flow.executionLeaseTtlMs': 60_000,
                'playbook-flow.executionLeaseHeartbeatMs': 30_000,
              };
              return key in values ? values[key] : fallback;
            }),
          },
        },
        {
          provide: SystemService,
          useValue: {
            getPlaybookSettings: jest.fn(async () => ({
              playbookExecution: {
                ...DEFAULT_ADMIN_PLAYBOOK_SETTINGS.playbookExecution,
                executionLeaseEnabled: enabled,
                availableCapacity: 2,
                maxConcurrentPerUser: 1,
                maxConcurrentPerFlow: 1,
                maxConcurrentPerProvider: 1,
                maxConcurrentPerModel: 1,
              },
            })),
          },
        },
      ],
    }).compile();

    service = module.get<PlaybookFlowExecutionLeaseService>(PlaybookFlowExecutionLeaseService);
  });

  afterEach(() => { service.onModuleDestroy(); });

  it('acquires one slot per scope for the first execution', async () => {
    const before = Date.now();
    const result = await service.acquire('exec-1', 'owner-1', 'flow-1');

    expect(result).toEqual({ acquired: true });
    expect(leases).toHaveLength(3);
    expect(leases.map((lease) => [lease.scopeType, lease.scopeKey, lease.slot])).toEqual([
      ['global', 'execution:global', 0],
      ['owner', 'execution:owner:owner-1', 0],
      ['flow', 'execution:flow:flow-1', 0],
    ]);
    expect(leases.every((lease) => lease.expiresAt.getTime() >= before + 60_000)).toBe(true);
    expect(leaseRepository.deleteExpired).toHaveBeenCalledTimes(1);
  });

  it('rejects when the per-user limit is already exhausted and keeps no partial slot', async () => {
    await service.acquire('exec-1', 'owner-1', 'flow-1');

    const result = await service.acquire('exec-2', 'owner-1', 'flow-2');

    expect(result).toEqual({ acquired: false, reason: 'owner_limit' });
    expect(leases.filter((lease) => lease.executionId === 'exec-2')).toEqual([]);
  });

  it('moves on to the next free slot of a scope and refuses past its limit', async () => {
    expect(await service.acquire('exec-1', 'owner-1', 'flow-1')).toEqual({ acquired: true });
    expect(await service.acquire('exec-2', 'owner-2', 'flow-2')).toEqual({ acquired: true });
    expect(leases.filter((lease) => lease.scopeType === 'global').map((lease) => lease.slot)).toEqual([0, 1]);

    expect(await service.acquire('exec-3', 'owner-3', 'flow-3')).toEqual({ acquired: false, reason: 'global_limit' });
  });

  it('claims a slot again once the lease holding it has expired', async () => {
    await service.acquire('exec-1', 'owner-1', 'flow-1');
    leases.forEach((lease) => { lease.expiresAt = new Date(Date.now() - 1_000); });

    expect(await service.hasActiveLease('exec-1')).toBe(false);
    expect(await service.acquire('exec-2', 'owner-1', 'flow-1')).toEqual({ acquired: true });
    expect(await service.hasActiveLease('exec-2')).toBe(true);
  });

  it('adds provider and model scopes when the execution names them', async () => {
    await service.acquire('exec-1', 'owner-1', 'flow-1', { providerKey: 'openai', modelKey: 'gpt-x' });

    expect(leases.map((lease) => lease.scopeKey)).toEqual(expect.arrayContaining(['execution:provider:openai', 'execution:model:gpt-x']));
    expect(await service.acquire('exec-2', 'owner-2', 'flow-2', { providerKey: 'openai' })).toEqual({ acquired: false, reason: 'provider_limit' });
  });

  it('refreshes the expiry of every slot the execution holds', async () => {
    await service.acquire('exec-1', 'owner-1', 'flow-1');
    leases.forEach((lease) => { lease.expiresAt = new Date(Date.now() + 5_000); });

    await service.refresh('exec-1');

    expect(leaseRepository.refresh).toHaveBeenCalledWith('exec-1', expect.any(Date));
    expect(leases.every((lease) => lease.expiresAt.getTime() > Date.now() + 50_000)).toBe(true);
  });

  it('releases all scoped slots for an execution', async () => {
    await service.acquire('exec-1', 'owner-1', 'flow-1');

    await service.release('exec-1');

    expect(leases).toHaveLength(0);
  });

  it('grants everything and touches no lease when leases are disabled', async () => {
    enabled = false;

    expect(await service.acquire('exec-1', 'owner-1', 'flow-1')).toEqual({ acquired: true });
    expect(await service.hasActiveLease('exec-1')).toBe(false);
    await service.refresh('exec-1');
    await service.release('exec-1');

    for (const method of Object.values(leaseRepository)) expect(method).not.toHaveBeenCalled();
  });
});
