import { describe, expect, it } from 'vitest';
import { buildTimingClipboardText } from './timing-clipboard';
import type { ConversationLatencyMetricsV1 } from '../types';

const labels: Record<string, string> = {
  'latency.title': 'Response latency',
  'latency.backendPreAdk': 'Backend pre-ADK:',
  'latency.adkPreProvider': 'ADK pre-provider:',
  'latency.providerTtft': 'Provider TTFT:',
  'latency.adkForwarding': 'ADK forwarding:',
  'latency.backendForwarding': 'Backend forwarding:',
  'latency.frontendRender': 'Frontend render:',
  'latency.backendBreakdown.controllerValidationRouting': 'Controller validation/routing',
  'latency.backendBreakdown.userMessagePersistence': 'User message persistence',
  'latency.backendBreakdown.aiPlaceholderPersistence': 'AI placeholder persistence',
  'latency.backendBreakdown.streamBootstrap': 'Stream bootstrap',
  'latency.backendBreakdown.conversationContextLoad': 'Conversation context load',
  'latency.backendBreakdown.workspaceAgentResolution': 'Workspace & agent resolution',
  'latency.backendBreakdown.supplementalContextAssembly': 'Supplemental context assembly',
  'latency.backendBreakdown.grpcPayloadPreparation': 'gRPC payload preparation',
  'latency.backendBreakdown.grpcTransitToAdk': 'gRPC transit to ADK',
  'latency.adkBreakdown.protobufToDict': 'Request decoding',
  'latency.adkBreakdown.requestLogging': 'Request logging',
  'latency.adkBreakdown.requestConversion': 'Request conversion',
  'latency.adkBreakdown.workflowDispatch': 'Workflow dispatch',
  'latency.adkBreakdown.sessionLockWait': 'Session lock wait',
  'latency.adkBreakdown.orchestrationSetup': 'Orchestration setup',
  'latency.adkBreakdown.agentToolPreparation': 'Agent & tools setup',
  'latency.adkBreakdown.sessionRunnerSetup': 'Session / Runner setup',
  'latency.adkBreakdown.adkRuntimePreModel': 'ADK runtime pre-model',
  'latency.sessionRunnerBreakdown.sessionServiceInit': 'Session service init',
  'latency.sessionRunnerBreakdown.sessionLookup': 'Session lookup',
  'latency.sessionRunnerBreakdown.sessionCreateSeed': 'Session create / seed',
  'latency.sessionRunnerBreakdown.runnerConstruction': 'Runner construction',
  'latency.sessionRunnerBreakdown.runnerHandoff': 'Runner handoff',
  'latency.qualityOk': 'Timing quality: OK',
  'latency.partial': 'Timing quality: partial',
  'timing.title': 'Response Timing',
  'timing.firstChunk': 'Time to first chunk',
  'timing.firstToken': 'Time to first token',
  'timing.response': 'Response time',
  'timing.tokenUsage': 'Token Usage',
  'timing.inputTokens': 'Input tokens',
  'timing.outputTokens': 'Output tokens',
  'timing.totalTokens': 'Total',
};

const t = (key: string): string => labels[key] ?? key;

const metrics: ConversationLatencyMetricsV1 = {
  schemaVersion: 1,
  backendPreAdkMs: 2300,
  backendPreAdkBreakdown: {
    controllerValidationRoutingMs: 42,
    grpcTransitToAdkMs: 3,
  },
  adkPreProviderMs: 2940,
  adkPreProviderBreakdown: {
    requestLoggingMs: 412,
    sessionRunnerSetupMs: 1380,
    sessionRunnerSetupBreakdown: {
      sessionLookupMs: 120,
      runnerHandoffMs: 4,
    },
    adkRuntimePreModelMs: 875,
  },
  providerTtftMs: 575,
  quality: 'ok',
};

describe('buildTimingClipboardText', () => {
  it('copies the visible hierarchy with nesting, quality, timing and usage', () => {
    const text = buildTimingClipboardText({
      latencyMetrics: metrics,
      timeToFirstChunk: 5,
      timeToFirstToken: 3500,
      durationMs: 3900,
      inputTokens: 188,
      outputTokens: 9,
      translate: t,
    });
    expect(text).toBe([
      'Response latency',
      'Backend pre-ADK: 2.30 s',
      '  Controller validation/routing: 42 ms',
      '  User message persistence: —',
      '  AI placeholder persistence: —',
      '  Stream bootstrap: —',
      '  Conversation context load: —',
      '  Workspace & agent resolution: —',
      '  Supplemental context assembly: —',
      '  gRPC payload preparation: —',
      '  gRPC transit to ADK: 3 ms',
      'ADK pre-provider: 2.94 s',
      '  Request decoding: —',
      '  Request logging: 412 ms',
      '  Request conversion: —',
      '  Workflow dispatch: —',
      '  Session lock wait: —',
      '  Orchestration setup: —',
      '  Agent & tools setup: —',
      '  Session / Runner setup: 1.38 s',
      '    Session service init: —',
      '    Session lookup: 120 ms',
      '    Session create / seed: —',
      '    Runner construction: —',
      '    Runner handoff: 4 ms',
      '  ADK runtime pre-model: 875 ms',
      'Provider TTFT: 575 ms',
      'ADK forwarding: —',
      'Backend forwarding: —',
      'Frontend render: —',
      'Timing quality: OK',
      '',
      'Response Timing',
      'Time to first chunk: 5ms',
      'Time to first token: 3.5s',
      'Response time: 3.9s',
      '',
      'Token Usage',
      'Input tokens: 188',
      'Output tokens: 9',
      'Total: 197',
    ].join('\n'));
  });

  it('copies a partial breakdown with every child row rendered as an em-dash', () => {
    const text = buildTimingClipboardText({
      latencyMetrics: {
        schemaVersion: 1,
        providerTtftMs: 1234.5,
        quality: 'partial',
        adkPreProviderBreakdown: { requestLoggingMs: 412 },
      },
      translate: t,
    });
    const lines = text.split('\n');
    expect(lines[0]).toBe('Response latency');
    expect(lines).toContain('  Request logging: 412 ms');
    expect(lines).toContain('Provider TTFT: 1.23 s');
    expect(lines).toContain('Backend pre-ADK: —');
    expect(lines).toContain('Timing quality: partial');
    // Token usage section is omitted when there is no usage.
    expect(text).not.toContain('Token Usage');
  });
});
