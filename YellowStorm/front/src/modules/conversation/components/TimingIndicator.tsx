import { memo } from 'react';
import { Clock } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { CodeBlockCopyButton } from '@/components/ai-elements/code-block';
import { formatTimingMs } from '../utils';
import { buildTimingClipboardText, formatLatencyValue } from '../utils/timing-clipboard';
import { useModuleTranslation } from '@/modules/localization';
import { conversationFeatures } from '../features';
import type { ConversationLatencyMetricsV1 } from '../types';

interface TimingIndicatorProps {
  timeToFirstChunk?: number;
  timeToFirstToken?: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  latencyMetrics?: ConversationLatencyMetricsV1;
  /** Admin → Conversation runtime switch; the latency UI hides when it is off. */
  latencyInstrumentationEnabled?: boolean;
}

function formatCompactTokens(value: number | undefined, language: string): string {
  if (value == null) return '-';
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString(language, { maximumFractionDigits: 1 })}M`;
  if (value >= 1_000) return `${(value / 1_000).toLocaleString(language, { maximumFractionDigits: 1 })}k`;
  return value.toLocaleString(language);
}

/** Exactly one row per required latency stage, in pipeline order. */
const LATENCY_ROWS = [
  { key: 'backendPreAdkMs', labelKey: 'latency.backendPreAdk' },
  { key: 'adkPreProviderMs', labelKey: 'latency.adkPreProvider' },
  { key: 'providerTtftMs', labelKey: 'latency.providerTtft' },
  { key: 'adkForwardingMs', labelKey: 'latency.adkForwarding' },
  { key: 'backendForwardingMs', labelKey: 'latency.backendForwarding' },
  { key: 'frontendRenderMs', labelKey: 'latency.frontendRender' },
] as const satisfies ReadonlyArray<{ key: keyof ConversationLatencyMetricsV1; labelKey: string }>;

/** Diagnostic children of backendPreAdkMs, rendered indented under that row. */
const BACKEND_PRE_ADK_CHILD_ROWS = [
  { key: 'controllerValidationRoutingMs', labelKey: 'latency.backendBreakdown.controllerValidationRouting' },
  { key: 'userMessagePersistenceMs', labelKey: 'latency.backendBreakdown.userMessagePersistence' },
  { key: 'aiPlaceholderPersistenceMs', labelKey: 'latency.backendBreakdown.aiPlaceholderPersistence' },
  { key: 'streamBootstrapMs', labelKey: 'latency.backendBreakdown.streamBootstrap' },
  { key: 'conversationContextLoadMs', labelKey: 'latency.backendBreakdown.conversationContextLoad' },
  { key: 'workspaceAgentResolutionMs', labelKey: 'latency.backendBreakdown.workspaceAgentResolution' },
  { key: 'supplementalContextAssemblyMs', labelKey: 'latency.backendBreakdown.supplementalContextAssembly' },
  { key: 'grpcPayloadPreparationMs', labelKey: 'latency.backendBreakdown.grpcPayloadPreparation' },
  { key: 'grpcTransitToAdkMs', labelKey: 'latency.backendBreakdown.grpcTransitToAdk' },
] as const satisfies ReadonlyArray<{
  key: keyof NonNullable<ConversationLatencyMetricsV1['backendPreAdkBreakdown']>;
  labelKey: string;
}>;

/** Diagnostic children of adkPreProviderMs, rendered indented under that row. */
const ADK_PRE_PROVIDER_CHILD_ROWS = [
  { key: 'protobufToDictMs', labelKey: 'latency.adkBreakdown.protobufToDict' },
  { key: 'requestLoggingMs', labelKey: 'latency.adkBreakdown.requestLogging' },
  { key: 'requestConversionMs', labelKey: 'latency.adkBreakdown.requestConversion' },
  { key: 'workflowDispatchMs', labelKey: 'latency.adkBreakdown.workflowDispatch' },
  { key: 'sessionLockWaitMs', labelKey: 'latency.adkBreakdown.sessionLockWait' },
  { key: 'orchestrationSetupMs', labelKey: 'latency.adkBreakdown.orchestrationSetup' },
  { key: 'agentToolPreparationMs', labelKey: 'latency.adkBreakdown.agentToolPreparation' },
  { key: 'sessionRunnerSetupMs', labelKey: 'latency.adkBreakdown.sessionRunnerSetup' },
  { key: 'adkRuntimePreModelMs', labelKey: 'latency.adkBreakdown.adkRuntimePreModel' },
] as const satisfies ReadonlyArray<{
  key: keyof NonNullable<ConversationLatencyMetricsV1['adkPreProviderBreakdown']>;
  labelKey: string;
}>;

/** Second-level children of the session/runner setup pre-provider child. */
const SESSION_RUNNER_SETUP_CHILD_ROWS = [
  { key: 'sessionServiceInitMs', labelKey: 'latency.sessionRunnerBreakdown.sessionServiceInit' },
  { key: 'sessionLookupMs', labelKey: 'latency.sessionRunnerBreakdown.sessionLookup' },
  { key: 'sessionCreateSeedMs', labelKey: 'latency.sessionRunnerBreakdown.sessionCreateSeed' },
  { key: 'runnerConstructionMs', labelKey: 'latency.sessionRunnerBreakdown.runnerConstruction' },
  { key: 'runnerHandoffMs', labelKey: 'latency.sessionRunnerBreakdown.runnerHandoff' },
] as const satisfies ReadonlyArray<{
  key: keyof NonNullable<
    NonNullable<ConversationLatencyMetricsV1['adkPreProviderBreakdown']>['sessionRunnerSetupBreakdown']
  >;
  labelKey: string;
}>;

function hasLatencyMetrics(metrics: ConversationLatencyMetricsV1 | undefined): boolean {
  if (!metrics) return false;
  return LATENCY_ROWS.some(({ key }) => metrics[key] !== undefined);
}

export const TimingIndicator = memo(function TimingIndicator({ timeToFirstChunk, timeToFirstToken, durationMs, inputTokens, outputTokens, latencyMetrics, latencyInstrumentationEnabled }: TimingIndicatorProps) {
  const { t, language } = useModuleTranslation('conversation');
  const hasTokenUsage = inputTokens != null || outputTokens != null;
  // The Admin runtime switch is the source of truth; the build-time flag stays
  // only as an emergency hard-disable. Token usage is independent of it.
  const latencyUiAllowed = conversationFeatures.latencyUiEnabled && latencyInstrumentationEnabled !== false;
  const showLatencyPopover = latencyUiAllowed && hasLatencyMetrics(latencyMetrics);
  if (!showLatencyPopover && !timeToFirstChunk && !timeToFirstToken && !durationMs && !hasTokenUsage) {
    return null;
  }

  const usageStats = hasTokenUsage && (
    <>
      <div className='border-t border-border my-1' />
      <div className='text-xs font-medium mb-1'>{t('timing.tokenUsage')}</div>
      <div className='text-xs grid grid-cols-2 gap-x-3 gap-y-0.5'>
        <span className='text-muted-foreground'>{t('timing.inputTokens')}</span>
        <span>{inputTokens?.toLocaleString(language) ?? '—'}</span>
        <span className='text-muted-foreground'>{t('timing.outputTokens')}</span>
        <span>{outputTokens?.toLocaleString(language) ?? '—'}</span>
        {inputTokens != null && outputTokens != null && (
          <>
            <span className='text-muted-foreground'>{t('timing.totalTokens')}</span>
            <span>{(inputTokens + outputTokens).toLocaleString(language)}</span>
          </>
        )}
      </div>
    </>
  );

  const legacyStats = latencyUiAllowed && (
    <>
      <div className='border-t border-border my-1' />
      <div className='text-xs font-medium mb-1'>{t('timing.title')}</div>
      <div className='text-xs grid grid-cols-2 gap-x-3 gap-y-0.5'>
        <span className='text-muted-foreground'>{t('timing.firstChunk')}</span>
        <span>{formatTimingMs(timeToFirstChunk)}</span>
        <span className='text-muted-foreground'>{t('timing.firstToken')}</span>
        <span>{formatTimingMs(timeToFirstToken)}</span>
        <span className='text-muted-foreground'>{t('timing.response')}</span>
        <span>{formatTimingMs(durationMs)}</span>
      </div>
      {usageStats}
    </>
  );

  if (showLatencyPopover && latencyMetrics) {
    const clipboardText = buildTimingClipboardText({
      latencyMetrics,
      timeToFirstChunk,
      timeToFirstToken,
      durationMs,
      inputTokens,
      outputTokens,
      translate: (key: string) => t(key as Parameters<typeof t>[0]),
    });
    const breakdown = latencyMetrics.adkPreProviderBreakdown;
    const backendBreakdown = latencyMetrics.backendPreAdkBreakdown;
    return (
      <Popover>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <PopoverTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                className='size-11 md:size-7'
                aria-label={t('latency.openDetails')}
                data-response-latency
              >
                <Clock className='h-3.5 w-3.5' />
              </Button>
            </PopoverTrigger>
            <TooltipContent>{t('latency.openDetails')}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <PopoverContent side='top' align='start' className='w-80'>
          <div className='flex items-center justify-between gap-2 mb-1'>
            <div className='text-xs font-medium'>{t('latency.title')}</div>
            <CodeBlockCopyButton
              code={clipboardText}
              className='size-6'
              aria-label={t('latency.copyDetails')}
              title={t('latency.copyDetails')}
            />
          </div>
          <div className='text-xs grid grid-cols-2 gap-x-3 gap-y-0.5'>
            {LATENCY_ROWS.map(({ key, labelKey }) => (
              <div key={key} className='col-span-2 grid grid-cols-2 gap-x-3 gap-y-0.5'>
                <span className='text-muted-foreground'>{t(labelKey)}</span>
                <span>{formatLatencyValue(latencyMetrics[key] as number | undefined)}</span>
                {key === 'backendPreAdkMs' && backendBreakdown && (
                  <div className='col-span-2 ml-3 border-l border-border pl-2'>
                    {BACKEND_PRE_ADK_CHILD_ROWS.map(({ key: childKey, labelKey: childLabelKey }) => (
                      <div key={childKey} className='grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]'>
                        <span className='text-muted-foreground/80'>
                          <span aria-hidden='true'>↳ </span>
                          <span>{t(childLabelKey)}</span>
                        </span>
                        <span className='text-muted-foreground'>
                          {formatLatencyValue(backendBreakdown[childKey])}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {key === 'adkPreProviderMs' && breakdown && (
                  <div className='col-span-2 ml-3 border-l border-border pl-2'>
                    {ADK_PRE_PROVIDER_CHILD_ROWS.map(({ key: childKey, labelKey: childLabelKey }) => (
                      <div key={childKey} className='grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]'>
                        <span className='text-muted-foreground/80'>
                          <span aria-hidden='true'>↳ </span>
                          <span>{t(childLabelKey)}</span>
                        </span>
                        <span className='text-muted-foreground'>
                          {formatLatencyValue(breakdown[childKey])}
                        </span>
                        {childKey === 'sessionRunnerSetupMs' && breakdown.sessionRunnerSetupBreakdown && (
                          <div className='col-span-2 ml-3 border-l border-border pl-2'>
                            {SESSION_RUNNER_SETUP_CHILD_ROWS.map(({ key: nestedKey, labelKey: nestedLabelKey }) => (
                              <div key={nestedKey} className='grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]'>
                                <span className='text-muted-foreground/80'>
                                  <span aria-hidden='true'>↳ </span>
                                  <span>{t(nestedLabelKey)}</span>
                                </span>
                                <span className='text-muted-foreground'>
                                  {formatLatencyValue(breakdown.sessionRunnerSetupBreakdown?.[nestedKey])}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className='border-t border-border my-1' />
          <div className='text-xs text-muted-foreground'>
            {latencyMetrics.quality === 'clock-skew'
              ? t('latency.clockSkew')
              : latencyMetrics.quality === 'partial'
                ? t('latency.partial')
                : t('latency.qualityOk')}
          </div>
          {legacyStats}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='inline-flex items-center gap-1.5 px-1 text-xs text-muted-foreground cursor-default'>
            {latencyUiAllowed && <span>{formatTimingMs(timeToFirstChunk)}</span>}
            {hasTokenUsage && (
              <span data-response-token-usage aria-label={`${t('timing.inputTokens')} ${inputTokens?.toLocaleString(language) ?? '-'}, ${t('timing.outputTokens')} ${outputTokens?.toLocaleString(language) ?? '-'}`}>
                {t('timing.compactTokens')}: {formatCompactTokens(inputTokens, language)}/{formatCompactTokens(outputTokens, language)}
              </span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side='top' className='space-y-1'>
          {legacyStats}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});
