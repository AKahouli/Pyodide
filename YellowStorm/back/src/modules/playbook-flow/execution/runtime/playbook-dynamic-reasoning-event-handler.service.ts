import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  FlowDynamicReasoningAttempt,
  FlowDynamicReasoningAttemptDocument,
} from '../../schemas/playbook-flow-dynamic-reasoning-attempt.schema';
import { FlowExecution, FlowExecutionDocument } from '../../schemas/playbook-flow-execution.schema';
import { PlaybookFlowStreamEventsService } from '../../services/playbook-flow-stream-events.service';

const DYNAMIC_EVENTS = new Set([
  'DynamicPlanningStarted', 'DynamicReasoningDecided', 'DynamicPlanProposed',
  'DynamicPlanValidationFailed', 'DynamicPlanRepairStarted', 'DynamicPlanRepaired',
  'RuntimeSubgraphCreated', 'RuntimeSubgraphCompleted', 'RuntimeSubgraphFailed',
  'DynamicDirectFallback', 'DynamicPlanningFailed',
]);

@Injectable()
export class PlaybookDynamicReasoningEventHandlerService {
  constructor(
    @InjectModel(FlowDynamicReasoningAttempt.name)
    private readonly attemptModel: Model<FlowDynamicReasoningAttemptDocument>,
    @InjectModel(FlowExecution.name)
    private readonly executionModel: Model<FlowExecutionDocument>,
    private readonly streamEvents: PlaybookFlowStreamEventsService,
  ) {}

  supports(eventType: string): boolean {
    return DYNAMIC_EVENTS.has(eventType);
  }

  async handle(executionId: string, eventType: string, parentTaskId: string, parentIteration: number, payload: Record<string, unknown>): Promise<void> {
    const execution = await this.executionModel.findById(executionId, { flowId: 1 }).lean().exec();
    if (!execution) return;
    const identity = { executionId, parentTaskId, parentIteration, attempt: 0 };
    const set: Record<string, unknown> = {};
    if (eventType === 'DynamicPlanningStarted') {
      set.status = 'planning';
      set.planningStartedAt = new Date();
      set.inputContextSummary = payload.inputContext;
      set.contextFingerprint = (payload.inputContext as Record<string, unknown> | undefined)?.contextFingerprint;
    } else if (eventType === 'DynamicReasoningDecided') {
      set.decision = payload;
      set.status = payload.mode === 'direct' ? 'direct' : 'planning';
    } else if (eventType === 'RuntimeSubgraphCreated') {
      set.status = 'running';
      set.subgraphId = payload.subgraphId;
      set.acceptedRevision = payload.acceptedRevision;
      set.acceptedPlan = payload.plan;
      set.acceptedAt = new Date();
    } else if (eventType === 'RuntimeSubgraphCompleted') {
      set.status = 'completed';
      set.completedAt = new Date();
    } else if (eventType === 'RuntimeSubgraphFailed' || eventType === 'DynamicPlanningFailed') {
      set.status = 'failed';
      set.error = { message: String(payload.error || 'Dynamic reasoning failed') };
      set.completedAt = new Date();
    } else if (eventType === 'DynamicDirectFallback') {
      set.status = 'direct';
      set.fallbackReason = 'invalid_plan_safe_direct';
      if (payload.decision && typeof payload.decision === 'object') {
        set.decision = payload.decision;
      }
    }

    const update: Record<string, unknown> = {
      $set: set,
      $setOnInsert: { ...identity, flowId: String(execution.flowId) },
    };
    await this.attemptModel.updateOne(identity, update, { upsert: true }).exec();

    if (eventType === 'DynamicPlanProposed' || eventType === 'DynamicPlanRepaired') {
      const revision = Number(payload.revision ?? 0);
      const kind = eventType === 'DynamicPlanProposed' ? 'proposal' : 'repair';
      await this.attemptModel.updateOne(
        { ...identity, revisions: { $not: { $elemMatch: { revision, kind } } } },
        {
          $push: {
            revisions: {
              revision,
              kind,
              plan: payload.plan,
              validationIssues: [],
              createdAt: new Date(),
            },
          },
        },
      ).exec();
    }
    this.streamEvents.emitDynamicReasoningUpdate(executionId, eventType, parentTaskId, parentIteration, payload);
  }
}
