import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Eye, Loader2, RotateCcw, XCircle } from 'lucide-react';
import { CodeBlockCopyButton } from '@/components/ai-elements/code-block';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useModuleTranslation } from '@/modules/localization';
import { fetchToolResult } from '../../api';
import type { MessageComponent, ToolActivityData } from '../../types';
import { formatActivityDuration, formatToolResponsePayload, resolveToolDescription, resolveToolDisplayKey, resolveToolFallbackName, resolveToolRequest, resolveToolShortName, resolveToolSummary } from '../../utils/tool-activity';

export function statusIcon(status: ToolActivityData['status'] | 'running' | 'completed' | 'failed' | 'stopped', active = true) {
  if (status === 'running') return active ? <Loader2 data-tool-spinner className='size-3.5 animate-spin text-primary' /> : null;
  if (status === 'failed') return <XCircle className='size-3.5 text-destructive' />;
  if (status === 'stopped') return <AlertTriangle className='size-3.5 text-amber-600 dark:text-amber-400' />;
  return <CheckCircle2 className='size-3.5 text-green-500' />;
}

function formatToolTimestamp(data: ToolActivityData, language: string): { compact: string; full: string; dateTime: string } | undefined {
  const completedAt = new Date(data.completedAt || '');
  const startedAt = new Date(data.startedAt || '');
  const date = !Number.isNaN(completedAt.getTime())
    ? completedAt
    : !Number.isNaN(startedAt.getTime()) ? startedAt : undefined;
  if (!date) return undefined;
  return {
    compact: new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(date),
    full: new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'medium' }).format(date),
    dateTime: date.toISOString(),
  };
}

interface ToolDetailsProps {
  conversationId: string;
  messageId: string;
  componentId?: string;
  data: ToolActivityData;
  redactSensitiveText: boolean;
  fullToolName: string;
  summary?: string;
  compactTimestamp: string;
  fullTimestamp: string;
  timestampDateTime?: string;
  onRetry?: () => void;
}

function ToolPayload({ label, content, language, kind }: Readonly<{ label: string; content: string; language?: string; kind: 'request' | 'response' }>) {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <button type='button' data-tool-payload-trigger={kind} className='group flex min-h-10 w-full items-center gap-2 px-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'>
          <ChevronRight className='size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90' aria-hidden='true' />
          {label}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className='px-3 pb-3'>
        <pre data-tool-payload={kind} data-language={language || undefined} className='max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background/70 p-3 text-xs text-foreground'>{content}</pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

type ToolResponseRevealState = 'idle' | 'loading' | 'shown' | 'empty' | 'error';

/**
 * Tool responses are loaded from the persisted message only when requested.
 */
function useToolResponseReveal(conversationId: string, messageId: string, componentId: string | undefined, data: ToolActivityData, redactSensitiveText: boolean): {
  revealState: ToolResponseRevealState;
  load: () => Promise<void>;
  payload: string | undefined;
} {
  const [revealState, setRevealState] = useState<ToolResponseRevealState>('idle');
  const [fetchedPayload, setFetchedPayload] = useState<string>();

  const load = async () => {
    if (revealState === 'loading' || revealState === 'shown') return;
    if (!componentId) {
      setRevealState('empty');
      return;
    }
    setRevealState('loading');
    try {
      const { resultJson } = await fetchToolResult(conversationId, messageId, componentId);
      const formatted = resultJson ? formatToolResponsePayload(data, resultJson, redactSensitiveText) : undefined;
      setFetchedPayload(formatted);
      setRevealState(formatted ? 'shown' : 'empty');
    } catch {
      setRevealState('error');
    }
  };

  return { revealState, load, payload: fetchedPayload };
}

function ToolDetails({ conversationId, messageId, componentId, data, redactSensitiveText, fullToolName, summary, compactTimestamp, fullTimestamp, timestampDateTime, onRetry }: Readonly<ToolDetailsProps>) {
  const { t } = useModuleTranslation('conversation');
  const request = resolveToolRequest(data, redactSensitiveText);
  const [responseOpen, setResponseOpen] = useState(false);
  const { revealState, load, payload } = useToolResponseReveal(conversationId, messageId, componentId, data, redactSensitiveText);
  const isRunning = data.status === 'running';
  const copyText = [
    fullToolName,
    summary ? `${t('stream.activity.description')}: ${summary}` : undefined,
    `${t('stream.activity.timestamp')}: ${fullTimestamp}`,
    request ? `${t('stream.activity.request')}:\n${request}` : undefined,
    payload ? `${t('stream.activity.response')}:\n${payload}` : undefined,
  ].filter((value): value is string => Boolean(value)).join('\n\n');
  return (
    <CollapsibleContent className='px-1 pb-2 pt-1 sm:px-3'>
      <div data-tool-detail-card className='rounded-lg border border-border/70 bg-background/55 p-3 shadow-xs'>
        <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
          <div className='flex min-w-0 flex-1 items-baseline gap-2'>
            <span className='shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>{t('stream.activity.toolName')}</span>
            <span data-tool-full-name className='min-w-0 break-words text-sm font-medium text-foreground'>{fullToolName}</span>
          </div>
          <div data-tool-detail-actions className='ml-auto flex shrink-0 items-center gap-2'>
            {!isRunning && (
              <Dialog open={responseOpen} onOpenChange={setResponseOpen}>
                <DialogTrigger asChild>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    data-tool-payload-trigger='response'
                    onClick={() => void load()}
                    className='h-8 gap-1.5 rounded-md px-3 text-xs text-primary hover:text-primary'
                  >
                    {revealState === 'loading' ? <Loader2 className='size-3.5 animate-spin' aria-hidden='true' /> : <Eye className='size-3.5' aria-hidden='true' />}
                    {t('stream.activity.viewResponse')}
                  </Button>
                </DialogTrigger>
                <DialogContent data-tool-response-dialog aria-describedby={undefined} className='max-h-[85vh] max-w-3xl overflow-hidden'>
                  <DialogHeader>
                    <DialogTitle>{t('stream.activity.responseTitle', { tool: fullToolName })}</DialogTitle>
                  </DialogHeader>
                  {revealState === 'loading' && <div className='flex min-h-24 items-center justify-center'><Loader2 className='size-5 animate-spin text-primary' aria-hidden='true' /></div>}
                  {revealState === 'shown' && payload && <pre data-tool-payload='response' className='max-h-[65vh] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 text-xs text-foreground'>{payload}</pre>}
                  {revealState === 'empty' && <p className='text-sm text-muted-foreground'>{t('stream.activity.responseUnavailable')}</p>}
                  {revealState === 'error' && <p className='text-sm text-destructive'>{t('stream.activity.responseError')}</p>}
                </DialogContent>
              </Dialog>
            )}
            <time data-tool-timestamp dateTime={timestampDateTime} title={fullTimestamp} aria-label={fullTimestamp} className='text-xs tabular-nums text-muted-foreground'>{compactTimestamp}</time>
            <CodeBlockCopyButton code={copyText} aria-label={t('stream.activity.copyToolDetails')} title={t('stream.activity.copyToolDetails')} className='size-8' />
          </div>
        </div>
        {summary && <p data-tool-full-description className='mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground'>{summary}</p>}
        <div data-tool-payload-group className='mt-3 divide-y overflow-hidden rounded-md border border-border/70 bg-muted/20'>
          {request && <ToolPayload label={t('stream.activity.request')} content={request} language={data.primaryInputLanguage} kind='request' />}
          {!request && <p className='px-3 py-2.5 text-xs text-muted-foreground'>{t('stream.activity.requestUnavailable')}</p>}
          {isRunning && <p className='px-3 py-2.5 text-xs text-muted-foreground'>{t('stream.activity.responsePending')}</p>}
        </div>
        {data.status === 'failed' && onRetry && (
          <button type='button' onClick={onRetry} className='mt-2 inline-flex min-h-9 items-center gap-2 rounded-md border px-3 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'>
            <RotateCcw className='size-3.5' aria-hidden='true' />
            {t('stream.activity.retry')}
          </button>
        )}
      </div>
    </CollapsibleContent>
  );
}

export function ToolRow({ conversationId, messageId, component, redactSensitiveText, onRetry }: Readonly<{ conversationId: string; messageId: string; component: MessageComponent; redactSensitiveText: boolean; onRetry?: () => void }>) {
  const { t, language } = useModuleTranslation('conversation');
  const [open, setOpen] = useState(false);
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
  const fullToolName = resolveToolFallbackName(data, redactSensitiveText) || t('stream.activity.toolFallback');
  const shortToolName = resolveToolShortName(data, redactSensitiveText);
  const label = shortToolName && shortToolName !== fullToolName
    ? shortToolName
    : displayKey && displayKey in labels
      ? labels[displayKey as keyof typeof labels]
      : shortToolName || t('stream.activity.toolFallback');
  const summary = resolveToolSummary(data, redactSensitiveText);
  const description = resolveToolDescription(data, redactSensitiveText);
  const duration = formatActivityDuration(data.durationMs);
  const statusLabel = t(`stream.activity.toolStatus.${data.status}`);
  const rowAriaLabel = summary
    ? t('stream.activity.toolRowAria', { description: summary, tool: label, status: statusLabel })
    : t('stream.activity.toolRowAriaFallback', { tool: label, status: statusLabel });
  const timestamp = formatToolTimestamp(data, language);
  const compactTimestamp = timestamp?.compact || t('stream.activity.timestampUnavailable');
  const fullTimestamp = timestamp?.full || t('stream.activity.timestampUnavailable');
  const row = (
    <>
      <span data-tool-status={data.status} className='shrink-0' aria-hidden='true'>{statusIcon(data.status)}</span>
      <span className='min-w-0 flex-1'>
        {summary
          ? <span data-tool-summary className='block truncate font-medium leading-4 text-foreground'>{summary}</span>
          : <span data-tool-name className='block truncate font-medium leading-4 text-foreground'>{label}</span>}
        {summary && <span data-tool-name className='block truncate text-[11px] leading-3 text-muted-foreground'>{label}</span>}
      </span>
      {duration && <span className='shrink-0 tabular-nums'>- {duration}</span>}
      <ChevronRight className='size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90' aria-hidden='true' />
    </>
  );
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button type='button' aria-label={rowAriaLabel} className='group flex min-h-7 w-full items-center gap-2 rounded-lg border border-transparent px-2 py-0.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:border-border/70 data-[state=open]:bg-muted/55'>
          {row}
        </button>
      </CollapsibleTrigger>
      {open && <ToolDetails conversationId={conversationId} messageId={messageId} componentId={component.id} data={data} redactSensitiveText={redactSensitiveText} fullToolName={fullToolName} summary={description} compactTimestamp={compactTimestamp} fullTimestamp={fullTimestamp} timestampDateTime={timestamp?.dateTime} onRetry={onRetry} />}
    </Collapsible>
  );
}
