import { BadRequestException, ErrorCode } from '../../exceptions';
import type { RootNativeState } from './root-work.types';
import type { RootBackgroundJob } from '../persistence/postgres/root-background-job.store';
import { sanitizePublicComponent, sanitizeSerializedToolValue } from '../utils/public-component-sanitizer';
import { extractComponentData } from '../utils/component-mapper';
import { parseNativePendingInputs } from './native-pending-inputs';
import type { ComponentType } from '../interfaces/message.interface';

const invalid = () => new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid owned background event');
const publicFields: Partial<Record<ComponentType, readonly string[]>> = {
  code: ['content', 'language', 'filename', 'outputPortId'],
  agentActivity: ['summary', 'status', 'startedAt', 'completedAt', 'durationMs'],
  plan: ['title', 'steps'], queue: ['title', 'items'], checkpoint: ['label'],
  chart: ['title', 'data', 'chartData', 'config', 'xAxisKey', 'series', 'kind', 'yAxisKey', 'stacked',
    'layout', 'innerRadius', 'showLegend', 'showGrid', 'nameKey', 'zAxisKey'],
  task: ['task', 'taskOrder', 'status'], error: ['title'],
  sandbox: ['toolName', 'status', 'language', 'code', 'stdout', 'stderr', 'returncode', 'durationMs'],
  artifact: ['artifactId', 'filename', 'artifactKind', 'mimeType', 'sizeBytes', 'producerToolId', 'availability'],
  toolActivity: ['toolName', 'displayKey', 'fallbackDisplayName', 'summary', 'renderKind', 'status',
    'startedAt', 'completedAt', 'durationMs'],
  choice: ['message', 'choiceType', 'options', 'requestId', 'inputId'],
};

export interface RootBackgroundEventProposal {
  eventId: string;
  kind: 'lifecycle' | 'component' | 'usage';
  trace?: Record<string, unknown>;
  action?: 'add' | 'update';
  component?: Record<string, unknown>;
  usage?: { inputTokens: number; outputTokens: number; model?: string };
}

/** Public projection only; raw native recovery history stays in ADK storage. */
export function backgroundEventPayload(event: RootBackgroundEventProposal, job: RootBackgroundJob, state: RootNativeState) {
  if (!event || typeof event.eventId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(event.eventId)
    || Object.keys(event).some((key) => !['eventId', 'kind', 'trace', 'action', 'component', 'usage'].includes(key))) throw invalid();
  const lineage = { executionId: job.executionId, parentExecutionId: job.parentExecutionId,
    conversationEpoch: job.conversationEpoch, producerAgentId: String(state.rootContext.selected_agent_id ?? state.rootContext.root_agent_id), producerRole: state.scope.role };
  if (event.kind === 'lifecycle') {
    const trace = event.trace;
    if (!trace || event.component || event.usage || event.action || trace.execution_id !== job.executionId
      || trace.parent_execution_id !== job.parentExecutionId || trace.native_session_id !== job.nativeSessionId
      || !job.nativeInvocationId || trace.native_invocation_id !== job.nativeInvocationId
      || trace.producer_agent_id !== lineage.producerAgentId
      || trace.producer_role !== (state.scope.role === 'followup' ? 'EXECUTION_ROLE_FOLLOWUP'
        : state.scope.role === 'fanout_driver' ? 'EXECUTION_ROLE_FANOUT_DRIVER'
        : state.scope.role === 'library_worker' ? 'EXECUTION_ROLE_LIBRARY_WORKER' : 'EXECUTION_ROLE_TEMPORARY_WORKER')
      || !['INVOCATION_LIFECYCLE_STATE_STARTED', 'INVOCATION_LIFECYCLE_STATE_WAITING', 'INVOCATION_LIFECYCLE_STATE_COMPLETED',
        'INVOCATION_LIFECYCLE_STATE_CANCELLED', 'INVOCATION_LIFECYCLE_STATE_FAILED'].includes(String(trace.lifecycle))) throw invalid();
    const pendingInputs = parseNativePendingInputs(trace.pending_inputs);
    // A native hint never parks/releases the job or publishes completion.
    return { ...lineage, kind: 'native_hint', nativeInvocationId: job.nativeInvocationId,
      lifecycle: String(trace.lifecycle), pendingInputs };
  }
  if (event.kind === 'component') {
    if (!event.component || event.trace || event.usage || !['add', 'update'].includes(event.action ?? '')
      || typeof event.component.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(event.component.id)) throw invalid();
    const extracted = extractComponentData(event.component);
    const fields = publicFields[extracted.type];
    if (!fields) throw invalid();
    const data = Object.fromEntries(Object.entries(extracted.data).filter(([key]) => fields.includes(key)));
    if (extracted.type === 'error') data.content = 'Specialist outcome could not be confirmed';
    const component = sanitizePublicComponent({ id: `${job.executionId}_${event.component.id}`, type: extracted.type,
      data: { ...data, actorId: lineage.producerAgentId } });
    return { ...lineage, kind: 'component', action: event.action, component };
  }
  if (event.kind === 'usage') {
    const usage = event.usage;
    if (!usage || event.trace || event.component || event.action
      || Object.keys(usage).some((key) => !['inputTokens', 'outputTokens', 'model'].includes(key))
      || ![usage.inputTokens, usage.outputTokens].every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 100000000)
      || usage.model !== undefined && (typeof usage.model !== 'string' || usage.model.length > 256)) throw invalid();
    return { ...lineage, kind: 'usage', usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
      ...(usage.model === undefined ? {} : { model: sanitizeSerializedToolValue(usage.model) }) } };
  }
  throw invalid();
}
