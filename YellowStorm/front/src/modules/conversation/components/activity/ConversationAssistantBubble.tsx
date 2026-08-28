import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Bot, CheckCircle2, ChevronRight, Download, Eye, FileText, Loader2, RotateCcw, XCircle } from 'lucide-react';
import { AIMessageContent } from '@/components/ai-elements/ai-message-content';
import { CodeBlockCopyButton } from '@/components/ai-elements/code-block';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { showError } from '@/lib/notifications';
import { openFileViewerFromUrl } from '@/modules/file-viewer';
import { useModuleTranslation } from '@/modules/localization';
import { getArtifactDownloadUrl } from '../../api';
import type { AgentActivityData, ArtifactActivityData, ChoiceInteractionMetadata, MessageComponent, ToolActivityData } from '../../types';
import { mapConversationComponentsToContentParts } from '../../utils';
import { formatActivityDuration, humanizeToolTitle, resolveToolDescription, resolveToolDisplayKey, resolveToolFallbackName, resolveToolRequest, resolveToolResponse, resolveToolSummary, sanitizeActivityActorName, sanitizeActivityFilename, sanitizeActivitySummary, sanitizeAssistantDisplayText } from '../../utils/tool-activity';
import type { ChoiceComponentAction } from '@/components/ai-elements/choice/ChoicePartRenderer';
import { useConversationSettings } from '../../hooks/useConversationSettings';

interface NarrativeProps {
  conversationId: string;
  messageId: string;
  components: readonly MessageComponent[];
  answerComponents?: readonly MessageComponent[];
  isStreaming: boolean;
  showWorking?: boolean;
  choiceInteractions?: Map<string, ChoiceInteractionMetadata>;
  onComponentAction?: (action: ChoiceComponentAction) => Promise<void>;
  onSubmitQuestions?: (actions: ChoiceComponentAction[]) => Promise<void>;
  onRetry?: () => void;
}

function statusIcon(status: ToolActivityData['status'] | AgentActivityData['status'], active = true) {
  if (status === 'running') return active ? <Loader2 data-tool-spinner className='size-4 animate-spin text-primary' /> : null;
  if (status === 'failed') return <XCircle className='size-4 text-destructive' />;
  if (status === 'stopped') return <AlertTriangle className='size-4 text-amber-600 dark:text-amber-400' />;
  return <CheckCircle2 className='size-4 text-primary' />;
}

function formatToolTimestamp(data: ToolActivityData, language: string): string | undefined {
  const completedAt = new Date(data.completedAt || '');
  const startedAt = new Date(data.startedAt || '');
  const date = !Number.isNaN(completedAt.getTime())
    ? completedAt
    : !Number.isNaN(startedAt.getTime()) ? startedAt : undefined;
  if (!date) return undefined;
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
}

function collapseExactTandem(value: unknown): unknown {
  if (typeof value !== 'string' || value.length % 2 !== 0) return value;
  const midpoint = value.length / 2;
  return value.slice(0, midpoint) === value.slice(midpoint) ? value.slice(0, midpoint) : value;
}

function hasMeaningfulActivityText(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}

function projectActivityComponents(components: MessageComponent[]): MessageComponent[] {
  const hasReasoning = components.some((component) => component.type === 'agentActivity'
    && (String(component.data.detail || '').trim() || String(component.data.summary || '').trim()));
  const projected: MessageComponent[] = [];
  let previousReasoning = '';

  for (const component of components) {
    if (component.type === 'toolActivity') {
      previousReasoning = '';
      projected.push(component);
      continue;
    }
    if (component.type !== 'agentActivity') {
      projected.push(component);
      continue;
    }

    const detail = collapseExactTandem(component.data.detail);
    const normalized = { ...component, data: { ...component.data, detail } };
    const detailText = typeof detail === 'string' ? detail.trim() : '';
    const summaryText = String(component.data.summary || '').trim();
    if (hasReasoning && !detailText && !summaryText) continue;
    if ((detailText || summaryText) && !hasMeaningfulActivityText(`${detailText}${summaryText}`)) continue;

    const actor = String(component.data.actorId || component.data.actorName || 'assistant');
    const fingerprint = detailText ? `${actor}\u0000${detailText}` : '';
    if (fingerprint && fingerprint === previousReasoning) continue;
    previousReasoning = fingerprint;
    projected.push(normalized);
  }

  return projected;
}

interface ToolDetailsProps {
  data: ToolActivityData;
  summary?: string;
  timestamp: string;
  copyText: string;
  request?: string;
  response?: string;
  onRetry?: () => void;
}

function ToolDetails({ data, summary, timestamp, copyText, request, response, onRetry }: Readonly<ToolDetailsProps>) {
  const { t } = useModuleTranslation('conversation');
  return (
    <CollapsibleContent className='ml-6 border-l pb-2 pl-4 pr-2'>
      <div className='mb-3 flex items-start justify-between gap-3'>
        <div className='min-w-0 space-y-2'>
          {summary && (
            <div>
              <p className='mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{t('stream.activity.description')}</p>
              <p data-tool-full-description className='whitespace-pre-wrap break-words text-sm text-foreground'>{summary}</p>
            </div>
          )}
          <p data-tool-timestamp className='text-xs tabular-nums text-muted-foreground'>
            <span className='font-semibold'>{t('stream.activity.timestamp')}:</span> {timestamp}
          </p>
        </div>
        <CodeBlockCopyButton code={copyText} aria-label={t('stream.activity.copyToolDetails')} title={t('stream.activity.copyToolDetails')} className='size-8' />
      </div>
      {request && (
        <div className='mb-3'>
          <p className='mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{t('stream.activity.request')}</p>
          <pre data-language={data.primaryInputLanguage || undefined} className='max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-background/50 p-3 text-xs text-foreground'>{request}</pre>
        </div>
      )}
      {!request && <p className='mb-3 text-xs text-muted-foreground'>{t('stream.activity.requestUnavailable')}</p>}
      {response && (
        <div>
          <p className='mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{t('stream.activity.response')}</p>
          <pre className='max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-background/50 p-3 text-xs text-foreground'>{response}</pre>
        </div>
      )}
      {!response && <p className='text-xs text-muted-foreground'>{data.status === 'running' ? t('stream.activity.responsePending') : t('stream.activity.responseUnavailable')}</p>}
      {data.status === 'failed' && onRetry && (
        <button type='button' onClick={onRetry} className='mt-3 inline-flex min-h-9 items-center gap-2 rounded-md border px-3 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'>
          <RotateCcw className='size-3.5' aria-hidden='true' />
          {t('stream.activity.retry')}
        </button>
      )}
    </CollapsibleContent>
  );
}

function ToolRow({ component, sequence, redactSensitiveText, isStreaming, onRetry }: Readonly<{ component: MessageComponent; sequence: number; redactSensitiveText: boolean; isStreaming: boolean; onRetry?: () => void }>) {
  const { t, language } = useModuleTranslation('conversation');
  const data = component.data as ToolActivityData;
  const labels = {
    runCode: t('stream.activity.tool.runCode'), searchKnowledge: t('stream.activity.tool.searchKnowledge'),
    searchWeb: t('stream.activity.tool.searchWeb'), search: t('stream.activity.tool.search'),
    findFiles: t('stream.activity.tool.findFiles'), read: t('stream.activity.tool.read'),
    write: t('stream.activity.tool.write'), copy: t('stream.activity.tool.copy'),
    createSandbox: t('stream.activity.tool.createSandbox'), runCommand: t('stream.activity.tool.runCommand'),
    sendFile: t('stream.activity.tool.sendFile'),
  } as const;
  const displayKey = resolveToolDisplayKey(data);
  const label = displayKey && displayKey in labels
    ? labels[displayKey as keyof typeof labels]
    : resolveToolFallbackName(data, redactSensitiveText) || t('stream.activity.toolFallback');
  const summary = resolveToolSummary(data, redactSensitiveText);
  const description = resolveToolDescription(data, redactSensitiveText);
  const duration = formatActivityDuration(data.durationMs);
  const request = resolveToolRequest(data, redactSensitiveText);
  const response = resolveToolResponse(data, redactSensitiveText);
  const statusLabel = t(`stream.activity.toolStatus.${data.status}`);
  const timestamp = formatToolTimestamp(data, language) || t('stream.activity.timestampUnavailable');
  const copyText = [
    `${sequence}. ${label}`,
    description ? `${t('stream.activity.description')}: ${description}` : undefined,
    `${t('stream.activity.timestamp')}: ${timestamp}`,
    request ? `${t('stream.activity.request')}:\n${request}` : undefined,
    response ? `${t('stream.activity.response')}:\n${response}` : undefined,
  ].filter((value): value is string => Boolean(value)).join('\n\n');
  const row = (
    <>
      <span data-tool-status={data.status} aria-hidden='true'>{statusIcon(data.status, isStreaming)}</span>
      <span data-tool-sequence={sequence} className='shrink-0 tabular-nums text-foreground'>{sequence}.</span>
      <span className='shrink-0 font-medium text-foreground'>{label}</span>
      {summary && <span className='min-w-0 flex-1 truncate'>- {summary}</span>}
      {duration && <span className='shrink-0 tabular-nums'>- {duration}</span>}
      <ChevronRight className='size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90' aria-hidden='true' />
    </>
  );
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <button type='button' aria-label={t('stream.activity.toolRowAria', { sequence, tool: label, status: statusLabel })} className='group flex min-h-9 w-full items-center gap-2 rounded-md px-1 text-left text-sm text-muted-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'>
          {row}
        </button>
      </CollapsibleTrigger>
      <ToolDetails data={data} summary={description} timestamp={timestamp} copyText={copyText} request={request} response={response} onRetry={onRetry} />
    </Collapsible>
  );
}

function AgentActivityRow({ data, isStreaming }: Readonly<{ data: AgentActivityData; isStreaming: boolean }>) {
  const { t } = useModuleTranslation('conversation');
  const duration = formatActivityDuration(data.durationMs);
  const summary = sanitizeActivitySummary(data.summary) || t('stream.activity.agentPlanning');
  const active = isStreaming && data.status === 'running';
  const statusLabel = t(`stream.activity.toolStatus.${data.status}`);
  const detail = typeof data.detail === 'string' && data.detail.trim() ? data.detail : summary;
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <button type='button' aria-label={t('stream.activity.agentRowAria', { status: statusLabel })} className='group flex min-h-9 w-full items-center gap-2 rounded-md px-1 text-left text-sm text-muted-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'>
          <span data-agent-activity-spinner={active || undefined} aria-hidden='true'>{statusIcon(data.status, active)}</span>
          <span className='shrink-0 font-medium text-foreground'>{t('stream.activity.agent')}</span>
          <span className='min-w-0 flex-1 truncate'>- {summary}</span>
          {duration && <span className='shrink-0 tabular-nums'>- {duration}</span>}
          <ChevronRight className='size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90' aria-hidden='true' />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className='ml-6 border-l pb-2 pl-4 pr-2'>
        <p className='whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground'>{detail}</p>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ArtifactRow({ conversationId, messageId, data, enabled }: Readonly<{ conversationId: string; messageId: string; data: ArtifactActivityData; enabled: boolean }>) {
  const { t } = useModuleTranslation('conversation');
  const [loadingAction, setLoadingAction] = useState<'view' | 'download' | null>(null);
  const filename = sanitizeActivityFilename(data.filename) || t('stream.activity.generated');
  const view = async () => {
    if (!enabled || loadingAction) return;
    setLoadingAction('view');
    try {
      const { viewUrl } = await getArtifactDownloadUrl(conversationId, messageId, data.artifactId);
      openFileViewerFromUrl(viewUrl, filename, data.mimeType || 'application/octet-stream');
    } catch {
      showError(t('stream.activity.artifactError'));
    } finally {
      setLoadingAction(null);
    }
  };
  const download = async () => {
    if (!enabled || loadingAction) return;
    setLoadingAction('download');
    try {
      const { downloadUrl } = await getArtifactDownloadUrl(conversationId, messageId, data.artifactId);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = filename;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch {
      showError(t('stream.activity.artifactError'));
    } finally {
      setLoadingAction(null);
    }
  };
  const disabled = !enabled || Boolean(loadingAction) || data.availability !== 'ready';
  return (
    <div className='flex items-center gap-3 rounded-lg border bg-background/50 px-3 py-2 text-sm'>
      <FileText className='size-4 text-primary' aria-hidden='true' />
      <span className='min-w-0 flex-1 truncate'>{filename}</span>
      <button type='button' disabled={disabled} onClick={view} className='inline-flex items-center gap-1 font-medium text-primary disabled:text-muted-foreground'>
        {loadingAction === 'view' ? <Loader2 className='size-3.5 animate-spin' aria-hidden='true' /> : <Eye className='size-3.5' aria-hidden='true' />}
        {t('stream.activity.viewArtifact')}
      </button>
      <button type='button' disabled={disabled} onClick={download} className='inline-flex items-center gap-1 font-medium text-primary disabled:text-muted-foreground'>
        {loadingAction === 'download' ? <Loader2 className='size-3.5 animate-spin' aria-hidden='true' /> : <Download className='size-3.5' aria-hidden='true' />}
        {t('stream.activity.downloadArtifact')}
      </button>
    </div>
  );
}

function MobileActivityTimeline({ components, nodes, isStreaming }: Readonly<{ components: readonly MessageComponent[]; nodes: readonly ReactNode[]; isStreaming: boolean }>) {
  const { t } = useModuleTranslation('conversation');
  const runningIndex = components.findIndex((component) => component.data.status === 'running' || component.data.availability === 'pending');
  const currentIndex = runningIndex >= 0 ? runningIndex : components.length - 1;
  const current = components[currentIndex];
  if (!current) return null;

  const status = current.type === 'artifact'
    ? current.data.availability === 'failed' ? 'failed' : current.data.availability === 'pending' ? 'running' : 'completed'
    : current.data.status as ToolActivityData['status'] | AgentActivityData['status'];
  const label = current.type === 'toolActivity'
    ? resolveToolSummary(current.data) || resolveToolFallbackName(current.data) || t('stream.activity.toolFallback')
    : current.type === 'artifact'
      ? sanitizeActivityFilename(current.data.filename) || t('stream.activity.generated')
      : sanitizeActivitySummary(current.data.summary) || t('stream.activity.agentPlanning');
  const statusLabel = t(`stream.activity.toolStatus.${status}`);

  return (
    <Collapsible className='md:hidden'>
      <CollapsibleTrigger asChild>
        <button type='button' aria-label={t('stream.activity.mobileDetailsAria', { status: statusLabel })} className='group flex min-h-11 w-full items-center gap-2 rounded-md px-1 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'>
          <span aria-hidden='true'>{statusIcon(status, isStreaming)}</span>
          <span className='min-w-0 flex-1 truncate text-muted-foreground'>{label}</span>
          <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>{t('stream.activity.stepProgress', { current: currentIndex + 1, total: components.length })}</span>
          <ChevronRight className='size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90' aria-hidden='true' />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className='mt-2 space-y-2 border-t pt-2'>{nodes}</CollapsibleContent>
    </Collapsible>
  );
}

export function ConversationAssistantBubble(props: Readonly<NarrativeProps>) {
  const { t } = useModuleTranslation('conversation');
  const settings = useConversationSettings();
  const activityPaneRef = useRef<HTMLDivElement>(null);
  const redactSensitiveText = settings?.redactSensitiveText !== false;
  const useOriginalAnswer = !props.answerComponents || props.answerComponents === props.components;
  const source = useOriginalAnswer
    ? props.components
    : [...props.components.filter((component) => ['agentActivity', 'toolActivity', 'artifact'].includes(component.type)), ...props.answerComponents!];
  const activityNodes: ReactNode[] = [];
  const answerNodes: ReactNode[] = [];
  const activityComponents = projectActivityComponents(source.filter(
    (component): component is MessageComponent & { type: 'agentActivity' | 'toolActivity' | 'artifact' } =>
      component.type === 'agentActivity' || component.type === 'toolActivity' || component.type === 'artifact',
  ));
  const activityCount = activityComponents.length;
  useEffect(() => {
    const pane = activityPaneRef.current;
    if (pane) pane.scrollTop = pane.scrollHeight;
  }, [activityCount]);
  let answerBatch: MessageComponent[] = [];
  const flush = () => {
    if (!answerBatch.length) return;
    const parts = mapConversationComponentsToContentParts(answerBatch).map((part) =>
      part.type === 'text' ? { ...part, content: sanitizeAssistantDisplayText(part.content, redactSensitiveText) } : part,
    );
    if (props.isStreaming && parts.at(-1)?.type === 'text') (parts.at(-1) as { showCursor?: boolean }).showCursor = true;
    if (parts.length) answerNodes.push(<AIMessageContent key={`answer-${answerNodes.length}`} parts={parts} isStreaming={props.isStreaming} onComponentAction={props.onComponentAction} onSubmitQuestions={props.onSubmitQuestions} choiceInteractions={props.choiceInteractions} taskDisplay='activity' redactTaskDiagnostics={redactSensitiveText} citationScope={{ conversationId: props.conversationId, messageId: props.messageId }} />);
    answerBatch = [];
  };
  source.forEach((component) => {
    if (!['agentActivity', 'toolActivity', 'artifact'].includes(component.type)) answerBatch.push(component);
  });
  flush();
  let toolSequence = 0;
  activityComponents.forEach((component, index) => {
    if (component.type === 'agentActivity') activityNodes.push(<AgentActivityRow key={component.id || index} data={component.data as AgentActivityData} isStreaming={props.isStreaming} />);
    if (component.type === 'toolActivity') {
      toolSequence += 1;
      activityNodes.push(<ToolRow key={component.id || index} component={component} sequence={toolSequence} redactSensitiveText={redactSensitiveText} isStreaming={props.isStreaming} onRetry={props.onRetry} />);
    }
    if (component.type === 'artifact') activityNodes.push(<ArtifactRow key={component.id || index} conversationId={props.conversationId} messageId={props.messageId} data={component.data as ArtifactActivityData} enabled={!props.isStreaming} />);
  });
  if (!activityNodes.length && props.showWorking) activityNodes.push(<div key='working' className='flex items-center gap-2 text-sm text-muted-foreground'><Loader2 className='size-4 animate-spin text-primary' />{t('stream.activity.usingTools')}</div>);
  if (!activityNodes.length && !answerNodes.length) return null;
  const actorName = source.reduce<string>((name, component) => {
    if (component.type !== 'toolActivity') return name;
    const safeName = sanitizeActivityActorName((component.data as ToolActivityData).actorName);
    return safeName ? humanizeToolTitle(safeName) : name;
  }, '') || t('stream.activity.assistant');
  return (
    <div data-message-role='assistant' data-testid='conversation-assistant-bubble' className={cn('w-full rounded-2xl rounded-tl-sm border border-border/70 bg-muted/45 px-4 py-4 text-sm text-foreground shadow-xs dark:bg-muted/30')}>
      <div data-agent-activity data-active={props.isStreaming || undefined} className='mb-3 flex min-w-0 items-center gap-2 overflow-hidden text-sm text-muted-foreground' role={props.isStreaming ? 'status' : undefined}>
        <span className='relative flex size-8 shrink-0 items-center justify-center' aria-hidden='true'>
          {props.isStreaming && <Loader2 data-agent-spinner className='absolute size-7 animate-spin text-running [animation-duration:1.2s]' />}
          <Bot className={cn('relative size-4', props.isStreaming && 'text-running')} />
        </span>
        <span className='shrink-0 font-medium text-foreground'>{actorName}</span>
        <span className={cn('relative h-0.5 min-w-8 flex-1 overflow-hidden', props.isStreaming ? 'bg-running/20' : 'bg-border')} aria-hidden='true'>
          {props.isStreaming && <span data-agent-scan className='absolute inset-y-0 left-0 w-1/3 animate-agent-scan bg-gradient-to-r from-transparent via-running to-transparent' />}
        </span>
      </div>
      {activityComponents.length > 0
        ? <MobileActivityTimeline components={activityComponents} nodes={activityNodes} isStreaming={props.isStreaming} />
        : props.showWorking && <div data-mobile-working className='flex items-center gap-2 text-sm text-muted-foreground md:hidden'><Loader2 className='size-4 animate-spin text-primary' />{t('stream.activity.usingTools')}</div>}
      {activityNodes.length > 0 && (
        <div ref={activityPaneRef} data-activity-pane className='hidden h-[13.333rem] overflow-y-auto overscroll-contain pr-2 md:block'>
          <div data-desktop-activity className='space-y-2'>{activityNodes}</div>
        </div>
      )}
      {answerNodes.length > 0 && <div className={cn('space-y-2', activityNodes.length > 0 && 'mt-3 border-t pt-3')}>{answerNodes}</div>}
    </div>
  );
}
