import { WorkyInternalController } from './worky-internal.controller';
import { WorkyIdempotencyService } from '../services/worky-idempotency.service';
import { WorkyAuditService } from '../services/worky-audit.service';
import { WorkyPlanDeltaService } from '../services/worky-plan-delta.service';
import { WorkyEventService } from '../services/worky-event.service';
import { WorkyStreamService } from '../services/worky-stream.service';
import { WorkyGovernanceService } from '../services/worky-governance.service';
import { WorkyEphemeralWorkerService } from '../services/worky-ephemeral-worker.service';
import { WorkyExecutionService } from '../services/worky-execution.service';
import { Types } from 'mongoose';

describe('WorkyInternalController (idempotency contract)', () => {
  const streamObjectId = new Types.ObjectId();
  const streamId = streamObjectId.toString();
  const eventId = 'evt-dup-1';

  const makeController = (overrides: { claimImpl?: jest.Mock } = {}) => {
    const idempotency = {
      claim: overrides.claimImpl ?? jest.fn().mockResolvedValue({
        firstSeen: true,
        replay: false,
        record: { _id: new Types.ObjectId() },
      }),
    } as unknown as WorkyIdempotencyService;
    const audit = { append: jest.fn().mockResolvedValue(undefined) } as unknown as WorkyAuditService;
    const streams = {
      findByIdInternal: jest.fn().mockResolvedValue({ _id: streamObjectId, ownerUserId: new Types.ObjectId() }),
    } as unknown as WorkyStreamService;
    const planDeltaService = {
      apply: jest.fn().mockResolvedValue({
        streamId,
        basePlanVersion: 3,
        resultPlanVersion: 4,
        planDeltaId: new Types.ObjectId().toString(),
        createdTaskIds: [],
        updatedTaskIds: [],
        cancelledTaskIds: [],
        clarificationIds: [],
      }),
    } as unknown as WorkyPlanDeltaService;
    const events = { emit: jest.fn() } as unknown as WorkyEventService;
    const governance = { resolve: jest.fn() } as unknown as WorkyGovernanceService;
    const workerBinding = { bindForTask: jest.fn() } as unknown as WorkyEphemeralWorkerService;
    const execution = {} as unknown as WorkyExecutionService;
    const budget = { reserve: jest.fn(), recordCost: jest.fn() } as any;
    const taskModel = { findById: jest.fn() } as any;
    const interactions = { create: jest.fn(), findOne: jest.fn() } as any;
    const taskResults = { record: jest.fn().mockResolvedValue({
      taskResultId: new Types.ObjectId().toString(),
      taskId: 'tid',
      version: 1,
      status: 'done',
      replay: false,
    }) } as any;
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any;
    const controller = new WorkyInternalController(
      streams,
      idempotency,
      audit,
      planDeltaService,
      events,
      governance,
      workerBinding,
      execution,
      budget,
      taskModel,
      interactions,
      taskResults,
      logger,
    );
    return { controller, idempotency, audit, streams, planDeltaService, events, budget };
  };

  it('persists the idempotency record, applies, and audits on first delivery', async () => {
    const { controller, idempotency, audit, planDeltaService, events } = makeController();
    const result = await controller.planDelta(streamId, {
      eventId,
      basePlanVersion: 3,
      body: {
        create_tasks: [
          {
            title: 'Test task',
            lane: 'ready',
            actionCategory: 'internal_analysis',
          },
        ],
      },
    });

    expect(idempotency.claim).toHaveBeenCalledWith(streamId, eventId, 'plan-delta');
    expect(planDeltaService.apply).toHaveBeenCalledWith(
      expect.objectContaining({ streamId, basePlanVersion: 3, triggerEventId: eventId }),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ streamId, action: 'runtime.plan-delta' }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      expect.anything(),
      streamId,
      expect.objectContaining({ type: 'plan.delta.applied' }),
    );
    expect(result).toEqual(
      expect.objectContaining({ applied: true, replay: false, eventId, resultPlanVersion: 4 }),
    );
  });

  it('skips apply, audit, and event fan-out on a replay', async () => {
    const claim = jest.fn().mockResolvedValue({
      firstSeen: false,
      replay: true,
      record: { _id: new Types.ObjectId() },
    });
    const { controller, audit, planDeltaService, events } = makeController({ claimImpl: claim });
    const result = await controller.planDelta(streamId, {
      eventId,
      basePlanVersion: 3,
    });

    expect(claim).toHaveBeenCalledWith(streamId, eventId, 'plan-delta');
    expect(planDeltaService.apply).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({ applied: false, replay: true, eventId, resultPlanVersion: 0 }),
    );
  });

  it('emits an audit event when /audit is called', async () => {
    const { controller, audit } = makeController();
    await controller.auditEvent(streamId, {
      eventId: 'audit-1',
      action: 'runtime.note',
      details: { foo: 'bar' },
    });
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ streamId, action: 'runtime.note' }),
    );
  });

  it('rejects an unknown stream id', async () => {
    const streams = { findByIdInternal: jest.fn().mockResolvedValue(null) } as any;
    const idempotency = { claim: jest.fn() } as any;
    const audit = { append: jest.fn() } as any;
    const planDeltaService = { apply: jest.fn() } as any;
    const events = { emit: jest.fn() } as any;
    const governance = { resolve: jest.fn() } as any;
    const workerBinding = { bindForTask: jest.fn() } as any;
    const execution = {} as any;
    const budget = {} as any;
    const taskModel = { findById: jest.fn() } as any;
    const interactions = {} as any;
    const taskResults = {} as any;
    const logger = { setContext: jest.fn() } as any;
    const c = new WorkyInternalController(
      streams,
      idempotency,
      audit,
      planDeltaService,
      events,
      governance,
      workerBinding,
      execution,
      budget,
      taskModel,
      interactions,
      taskResults,
      logger,
    );
    await expect(
      c.planDelta('not-a-valid-id', { eventId: 'e', basePlanVersion: 0 }),
    ).rejects.toBeDefined();
  });
});
