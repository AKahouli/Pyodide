import { Injectable } from '@nestjs/common';
import {
  DynamicReasoningAttemptRepository,
  type DynamicReasoningAttemptPatch,
} from '../../persistence/dynamic-reasoning-attempt.repository';
import { ExecutionRepository } from '../../persistence/execution.repository';
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
    private readonly attemptRepository: DynamicReasoningAttemptRepository,
    private readonly executionRepository: ExecutionRepository,
    private readonly streamEvents: PlaybookFlowStreamEventsService,
  ) {}

  supports(eventType: string): boolean {
    return DYNAMIC_EVENTS.has(eventType);
  }

  async handle(executionId: string, eventType: string, parentTaskId: string, parentIteration: number, payload: Record<string, unknown>): Promise<void> {
    const execution = await this.executionRepository.findById(executionId);
    if (!execution) return;
    const identity = { executionId, parentTaskId, parentIteration, attempt: 0 };
    const set: DynamicReasoningAttemptPatch = {};
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

    // The run can be deleted between the read and the write: the foreign key refuses the attempt.
    const stored = await this.attemptRepository.upsert(identity, set, { flowId: execution.flowId });
    if (!stored) return;

    if (eventType === 'DynamicPlanProposed' || eventType === 'DynamicPlanRepaired') {
      await this.attemptRepository.pushRevision(identity, {
        revision: Number(payload.revision ?? 0),
        kind: eventType === 'DynamicPlanProposed' ? 'proposal' : 'repair',
        plan: payload.plan,
        validationIssues: [],
        createdAt: new Date(),
      });
    }
    this.streamEvents.emitDynamicReasoningUpdate(executionId, eventType, parentTaskId, parentIteration, payload);
  }
}
