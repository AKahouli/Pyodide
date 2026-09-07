import { AsyncLocalStorage } from 'async_hooks';
import type {
  AdkLatencyTracePayload,
  BackendPreAdkBreakdownV1,
} from '../interfaces/latency.interface';
import { MAX_PLAUSIBLE_STAGE_MS, validateCrossClockDurationMs } from '../interfaces/latency.interface';

/** Monotonic stages of the backend pre-ADK breakdown, in request order. */
export type BackendPreAdkStage =
  | 'controllerValidationRoutingMs'
  | 'userMessagePersistenceMs'
  | 'aiPlaceholderPersistenceMs'
  | 'streamBootstrapMs'
  | 'conversationContextLoadMs'
  | 'workspaceAgentResolutionMs'
  | 'supplementalContextAssemblyMs'
  | 'grpcPayloadPreparationMs';

const BACKEND_PRE_ADK_STAGES: readonly BackendPreAdkStage[] = [
  'controllerValidationRoutingMs',
  'userMessagePersistenceMs',
  'aiPlaceholderPersistenceMs',
  'streamBootstrapMs',
  'conversationContextLoadMs',
  'workspaceAgentResolutionMs',
  'supplementalContextAssemblyMs',
  'grpcPayloadPreparationMs',
];

interface StageInterval {
  startMonoNs?: bigint;
  endMonoNs?: bigint;
}

function isFiniteMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Request-scoped diagnostic tracker for the backend pre-ADK stages. Scalar
 * only, first-write-wins on both boundaries; stages missing a boundary are
 * omitted (never zeroed). The tracker lives in an AsyncLocalStorage so marks
 * can be one-liners across the controller → stream service → gRPC dispatch
 * chain without threading a parameter through every signature.
 */
export class BackendPreAdkTracker {
  private readonly startedMonoNs = process.hrtime.bigint();
  private readonly intervals = new Map<BackendPreAdkStage, StageInterval>();
  private grpcDispatchedEpochMs?: number;

  begin(stage: BackendPreAdkStage): void {
    const interval = this.intervals.get(stage) ?? {};
    if (interval.startMonoNs === undefined) {
      interval.startMonoNs = process.hrtime.bigint();
      this.intervals.set(stage, interval);
    }
  }

  end(stage: BackendPreAdkStage): void {
    const interval = this.intervals.get(stage) ?? {};
    if (interval.endMonoNs === undefined) {
      interval.endMonoNs = process.hrtime.bigint();
      this.intervals.set(stage, interval);
    }
  }

  /** Epoch stamp captured immediately before the gRPC dispatch to ADK. */
  markGrpcDispatched(): void {
    if (this.grpcDispatchedEpochMs === undefined) this.grpcDispatchedEpochMs = Date.now();
  }

  /**
   * Derive the persisted breakdown. Monotonic children must fall within the
   * plausible-stage bound; `grpcTransitToAdkMs` uses the cross-clock policy
   * but, as a diagnostic child, never contributes to the top-level quality.
   */
  toBreakdown(adkTrace?: AdkLatencyTracePayload): BackendPreAdkBreakdownV1 | undefined {
    const breakdown: BackendPreAdkBreakdownV1 = {};
    for (const stage of BACKEND_PRE_ADK_STAGES) {
      const { startMonoNs, endMonoNs } = this.intervals.get(stage) ?? {};
      if (startMonoNs === undefined || endMonoNs === undefined) continue;
      const durationMs = Number(endMonoNs - startMonoNs) / 1_000_000;
      if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > MAX_PLAUSIBLE_STAGE_MS) continue;
      breakdown[stage] = durationMs;
    }
    const adkReceivedEpochMs = adkTrace?.adk_request_received_epoch_ms;
    if (this.grpcDispatchedEpochMs !== undefined && isFiniteMs(adkReceivedEpochMs)) {
      const validated = validateCrossClockDurationMs(adkReceivedEpochMs - this.grpcDispatchedEpochMs);
      if (validated.quality !== 'clock-skew' && validated.value !== undefined) {
        breakdown.grpcTransitToAdkMs = validated.value;
      }
    }
    return Object.keys(breakdown).length > 0 ? breakdown : undefined;
  }
}

const trackerStorage = new AsyncLocalStorage<BackendPreAdkTracker>();

/**
 * Install a tracker for the current request when the admin switch allows it.
 * Called once at controller entry; the async context carries it through the
 * detached stream promise.
 */
export function activateBackendPreAdkTracker(enabled: boolean): void {
  if (enabled) trackerStorage.enterWith(new BackendPreAdkTracker());
}

export function getBackendPreAdkTracker(): BackendPreAdkTracker | undefined {
  return trackerStorage.getStore();
}

export function beginBackendPreAdkStage(stage: BackendPreAdkStage): void {
  trackerStorage.getStore()?.begin(stage);
}

export function endBackendPreAdkStage(stage: BackendPreAdkStage): void {
  trackerStorage.getStore()?.end(stage);
}

export function markGrpcDispatchedForLatency(): void {
  trackerStorage.getStore()?.markGrpcDispatched();
}
