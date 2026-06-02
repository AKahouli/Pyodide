import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { PlaybookFlowExecutionLeaseService } from './playbook-flow-execution-lease.service';

describe('PlaybookFlowExecutionLeaseService', () => {
  let service: PlaybookFlowExecutionLeaseService;
  let leaseDocs: Array<Record<string, unknown>>;

  beforeEach(async () => {
    leaseDocs = [];

    const leaseModel = {
      create: jest.fn(async (doc: Record<string, unknown>) => {
        const duplicate = leaseDocs.find((lease) => (
          lease.scopeKey === doc.scopeKey
          && lease.slot === doc.slot
        ));
        if (duplicate) {
          const error = new Error('duplicate') as Error & { code?: number };
          error.code = 11000;
          throw error;
        }

        leaseDocs.push({ ...doc });
        return doc;
      }),
      updateMany: jest.fn(async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        for (const lease of leaseDocs) {
          if (lease.executionId === filter.executionId) {
            lease.expiresAt = update.expiresAt;
          }
        }
        return { exec: async () => undefined };
      }),
      deleteMany: jest.fn((filter: Record<string, unknown>) => ({
        exec: async () => {
          leaseDocs = leaseDocs.filter((lease) => {
            if (filter.executionId) {
              return lease.executionId !== filter.executionId;
            }
            if (filter.expiresAt && typeof filter.expiresAt === 'object' && '$lte' in filter.expiresAt) {
              return (lease.expiresAt as Date) > (filter.expiresAt as { $lte: Date }).$lte;
            }
            return true;
          });
        },
      })),
      countDocuments: jest.fn(async (filter: Record<string, unknown>) => {
        const count = leaseDocs.filter((lease) => (
          lease.executionId === filter.executionId
          && (lease.expiresAt as Date) > (filter.expiresAt as { $gt: Date }).$gt
        )).length;
        return count;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybookFlowExecutionLeaseService,
        { provide: getModelToken('FlowExecutionLease'), useValue: leaseModel },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback: unknown) => {
              const values: Record<string, unknown> = {
                'playbook-flow.executionLeaseEnabled': true,
                'playbook-flow.maxConcurrentGlobalExecutions': 2,
                'playbook-flow.maxConcurrentPerUser': 1,
                'playbook-flow.maxConcurrentPerFlow': 1,
                'playbook-flow.executionLeaseTtlMs': 60_000,
                'playbook-flow.executionLeaseHeartbeatMs': 30_000,
              };
              return key in values ? values[key] : fallback;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<PlaybookFlowExecutionLeaseService>(PlaybookFlowExecutionLeaseService);
  });

  it('acquires one slot per scope for the first execution', async () => {
    const result = await service.acquire('exec-1', 'owner-1', 'flow-1');

    expect(result).toEqual({ acquired: true });
    expect(leaseDocs).toHaveLength(3);
  });

  it('rejects when the per-user limit is already exhausted', async () => {
    await service.acquire('exec-1', 'owner-1', 'flow-1');

    const result = await service.acquire('exec-2', 'owner-1', 'flow-2');

    expect(result).toEqual({ acquired: false, reason: 'owner_limit' });
  });

  it('releases all scoped slots for an execution', async () => {
    await service.acquire('exec-1', 'owner-1', 'flow-1');

    await service.release('exec-1');

    expect(leaseDocs).toHaveLength(0);
  });
});
