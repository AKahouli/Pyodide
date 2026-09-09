import type { ConversationLatencyMetricsV1 } from '../types';
import { formatTimingMs } from '../utils';

/**
 * Pure builder for the TimingIndicator clipboard export. Renders the same
 * hierarchy the popover shows as plain text: the six primary stages with
 * their diagnostic children (two-space indent, session/runner children
 * nested one level deeper), the timing quality, the legacy response timing
 * section, and token usage. Missing values keep the same placeholder the UI
 * renders. Callers only invoke this where the latency UI is allowed by the
 * admin toggle, so every visible section is copied.
 */
export interface TimingClipboardInput {
  latencyMetrics?: ConversationLatencyMetricsV1;
  timeToFirstChunk?: number;
  timeToFirstToken?: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  /** Translation lookup for the shared label keys (same keys the UI uses). */
  translate: (key: string) => string;
}

/** Same rendering as the popover rows: <1000 ms as integer, otherwise seconds. */
export function formatLatencyValue(value: number | undefined): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

const PRIMARY_ROWS = [
  'backendPreAdkMs',
  'adkPreProviderMs',
  'providerTtftMs',
  'adkForwardingMs',
  'backendForwardingMs',
  'frontendRenderMs',
] as const;

const ADK_CHILD_ROWS = [
  'protobufToDictMs',
  'requestLoggingMs',
  'requestConversionMs',
  'workflowDispatchMs',
  'sessionLockWaitMs',
  'orchestrationSetupMs',
  'agentToolPreparationMs',
  'sessionRunnerSetupMs',
  'adkRuntimePreModelMs',
] as const;

const SESSION_CHILD_ROWS = [
  'sessionServiceInitMs',
  'sessionLookupMs',
  'sessionCreateSeedMs',
  'runnerConstructionMs',
  'runnerHandoffMs',
] as const;

const BACKEND_CHILD_ROWS = [
  'controllerValidationRoutingMs',
  'userMessagePersistenceMs',
  'aiPlaceholderPersistenceMs',
  'streamBootstrapMs',
  'conversationContextLoadMs',
  'workspaceAgentResolutionMs',
  'supplementalContextAssemblyMs',
  'grpcPayloadPreparationMs',
  'grpcTransitToAdkMs',
] as const;

const STAGE_LABEL_KEYS: Record<string, string> = {
  backendPreAdkMs: 'latency.backendPreAdk',
  adkPreProviderMs: 'latency.adkPreProvider',
  providerTtftMs: 'latency.providerTtft',
  adkForwardingMs: 'latency.adkForwarding',
  backendForwardingMs: 'latency.backendForwarding',
  frontendRenderMs: 'latency.frontendRender',
};

const ADK_CHILD_LABEL_KEYS: Record<string, string> = {
  protobufToDictMs: 'latency.adkBreakdown.protobufToDict',
  requestLoggingMs: 'latency.adkBreakdown.requestLogging',
  requestConversionMs: 'latency.adkBreakdown.requestConversion',
  workflowDispatchMs: 'latency.adkBreakdown.workflowDispatch',
  sessionLockWaitMs: 'latency.adkBreakdown.sessionLockWait',
  orchestrationSetupMs: 'latency.adkBreakdown.orchestrationSetup',
  agentToolPreparationMs: 'latency.adkBreakdown.agentToolPreparation',
  sessionRunnerSetupMs: 'latency.adkBreakdown.sessionRunnerSetup',
  adkRuntimePreModelMs: 'latency.adkBreakdown.adkRuntimePreModel',
};

const SESSION_CHILD_LABEL_KEYS: Record<string, string> = {
  sessionServiceInitMs: 'latency.sessionRunnerBreakdown.sessionServiceInit',
  sessionLookupMs: 'latency.sessionRunnerBreakdown.sessionLookup',
  sessionCreateSeedMs: 'latency.sessionRunnerBreakdown.sessionCreateSeed',
  runnerConstructionMs: 'latency.sessionRunnerBreakdown.runnerConstruction',
  runnerHandoffMs: 'latency.sessionRunnerBreakdown.runnerHandoff',
};

const BACKEND_CHILD_LABEL_KEYS: Record<string, string> = {
  controllerValidationRoutingMs: 'latency.backendBreakdown.controllerValidationRouting',
  userMessagePersistenceMs: 'latency.backendBreakdown.userMessagePersistence',
  aiPlaceholderPersistenceMs: 'latency.backendBreakdown.aiPlaceholderPersistence',
  streamBootstrapMs: 'latency.backendBreakdown.streamBootstrap',
  conversationContextLoadMs: 'latency.backendBreakdown.conversationContextLoad',
  workspaceAgentResolutionMs: 'latency.backendBreakdown.workspaceAgentResolution',
  supplementalContextAssemblyMs: 'latency.backendBreakdown.supplementalContextAssembly',
  grpcPayloadPreparationMs: 'latency.backendBreakdown.grpcPayloadPreparation',
  grpcTransitToAdkMs: 'latency.backendBreakdown.grpcTransitToAdk',
};

export function buildTimingClipboardText({
  latencyMetrics,
  timeToFirstChunk,
  timeToFirstToken,
  durationMs,
  inputTokens,
  outputTokens,
  translate,
}: TimingClipboardInput): string {
  const lines: string[] = [translate('latency.title')];

  if (latencyMetrics) {
    for (const stage of PRIMARY_ROWS) {
      lines.push(`${translate(STAGE_LABEL_KEYS[stage])} ${formatLatencyValue(latencyMetrics[stage])}`);
      if (stage === 'backendPreAdkMs' && latencyMetrics.backendPreAdkBreakdown) {
        for (const child of BACKEND_CHILD_ROWS) {
          lines.push(`  ${translate(BACKEND_CHILD_LABEL_KEYS[child])}: ${formatLatencyValue(latencyMetrics.backendPreAdkBreakdown[child])}`);
        }
      }
      if (stage === 'adkPreProviderMs' && latencyMetrics.adkPreProviderBreakdown) {
        const breakdown = latencyMetrics.adkPreProviderBreakdown;
        for (const child of ADK_CHILD_ROWS) {
          lines.push(`  ${translate(ADK_CHILD_LABEL_KEYS[child])}: ${formatLatencyValue(breakdown[child])}`);
          if (child === 'sessionRunnerSetupMs' && breakdown.sessionRunnerSetupBreakdown) {
            for (const nested of SESSION_CHILD_ROWS) {
              lines.push(`    ${translate(SESSION_CHILD_LABEL_KEYS[nested])}: ${formatLatencyValue(breakdown.sessionRunnerSetupBreakdown[nested])}`);
            }
          }
        }
      }
    }
    lines.push(
      latencyMetrics.quality === 'clock-skew'
        ? translate('latency.clockSkew')
        : latencyMetrics.quality === 'partial'
          ? translate('latency.partial')
          : translate('latency.qualityOk'),
    );
  }

  const hasTokenUsage = inputTokens != null || outputTokens != null;
  if (timeToFirstChunk || timeToFirstToken || durationMs || latencyMetrics) {
    lines.push('', translate('timing.title'));
    lines.push(`${translate('timing.firstChunk')}: ${formatTimingMs(timeToFirstChunk)}`);
    lines.push(`${translate('timing.firstToken')}: ${formatTimingMs(timeToFirstToken)}`);
    lines.push(`${translate('timing.response')}: ${formatTimingMs(durationMs)}`);
  }

  if (hasTokenUsage) {
    lines.push('', translate('timing.tokenUsage'));
    lines.push(`${translate('timing.inputTokens')}: ${inputTokens?.toLocaleString() ?? '—'}`);
    lines.push(`${translate('timing.outputTokens')}: ${outputTokens?.toLocaleString() ?? '—'}`);
    if (inputTokens != null && outputTokens != null) {
      lines.push(`${translate('timing.totalTokens')}: ${(inputTokens + outputTokens).toLocaleString()}`);
    }
  }

  return lines.join('\n');
}
