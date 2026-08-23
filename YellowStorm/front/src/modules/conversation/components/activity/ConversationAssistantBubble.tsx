import { useState, type ReactNode } from 'react';
import { Bot, BrainCircuit, CheckCircle2, ChevronRight, Square, Code2, FileText, Loader2, Search, Wrench, XCircle } from 'lucide-react';
import { AIMessageContent } from '@/components/ai-elements/ai-message-content';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { openFileViewerFromUrl } from '@/modules/file-viewer';
import { useModuleTranslation } from '@/modules/localization';
import { getArtifactDownloadUrl } from '../../api';
import type { ArtifactActivityData, ChoiceInteractionMetadata, MessageComponent, ReasoningActivityData, ToolActivityData } from '../../types';
import { mapConversationComponentsToContentParts } from '../../utils';
import { formatActivityDuration, formatSanitizedToolText, humanizeToolTitle, resolveToolDisplayKey, resolveToolFallbackName, resolveToolSummary, sanitizeActivityActorName, sanitizeActivityFilename, sanitizeActivitySummary, sanitizeAssistantDisplayText } from '../../utils/tool-activity';
import type { ChoiceComponentAction } from '@/components/ai-elements/choice/ChoicePartRenderer';

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
}

function statusIcon(status: ToolActivityData['status'], active: boolean) {
  if (status === 'running') return <Loader2 data-tool-spinner={active || undefined} className={cn('size-4 text-primary', active && 'animate-spin motion-reduce:animate-none')} />;
  if (status === 'failed') return <XCircle className='size-4 text-destructive' />;
  if (status === 'stopped') return <Square className='size-4 text-muted-foreground' />;
  return <CheckCircle2 className='size-4 text-primary' />;
}

function ToolRow({ component, isStreaming }: Readonly<{ component: MessageComponent; isStreaming: boolean }>) {
  const { t } = useModuleTranslation('conversation');
  const data = component.data as ToolActivityData;
  const labels = {
    runCode: t('stream.activity.tool.runCode'), searchKnowledge: t('stream.activity.tool.searchKnowledge'),
    searchWeb: t('stream.activity.tool.searchWeb'), search: t('stream.activity.tool.search'),
    findFiles: t('stream.activity.tool.findFiles'), read: t('stream.activity.tool.read'),
    write: t('stream.activity.tool.write'), copy: t('stream.activity.tool.copy'),
  } as const;
  const displayKey = resolveToolDisplayKey(data);
  const label = displayKey && displayKey in labels
    ? labels[displayKey as keyof typeof labels]
    : resolveToolFallbackName(data) || t('stream.activity.toolFallback');
  const summary = resolveToolSummary(data);
  const duration = formatActivityDuration(data.durationMs);
  const output = formatSanitizedToolText(data.resultJson);
  const active = isStreaming && data.status === 'running';
  const icon = data.renderKind === 'run_code' || displayKey === 'runCode'
    ? <Code2 className='size-4' />
    : data.renderKind === 'search' || data.renderKind === 'web' || displayKey?.toLowerCase().includes('search')
      ? <Search className='size-4' />
      : <Wrench className='size-4' />;
  const row = (
    <>
      <span aria-hidden='true'>{data.status === 'completed' ? icon : statusIcon(data.status, active)}</span>
      <span className='shrink-0 font-medium text-foreground'>{label}</span>
      {summary && <span className='min-w-0 flex-1 truncate'>- {summary}</span>}
      {duration && <span className='shrink-0 tabular-nums'>- {duration}</span>}
      {output && <ChevronRight className='size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90' aria-hidden='true' />}
    </>
  );
  if (!output) return <div className='flex min-h-9 items-center gap-2 px-1 text-sm text-muted-foreground'>{row}</div>;
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <button type='button' aria-label={t('stream.activity.responseTitle', { tool: label })} className='group flex min-h-9 w-full items-center gap-2 rounded-md px-1 text-left text-sm text-muted-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'>
          {row}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className='ml-6 border-l pb-2 pl-4 pr-2'>
        <p className='mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{t('stream.activity.output')}</p>
        <pre className='max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-background/50 p-3 text-xs text-foreground'>{output}</pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ReasoningRow({ data, isStreaming }: Readonly<{ data: ReasoningActivityData; isStreaming: boolean }>) {
  const { t } = useModuleTranslation('conversation');
  const duration = formatActivityDuration(data.durationMs);
  const summary = sanitizeActivitySummary(data.summary) || t('stream.activity.reasoningPlanning');
  return (
    <div className='flex min-h-9 items-center gap-2 px-1 text-sm text-muted-foreground'>
      {isStreaming ? <Loader2 data-reasoning-spinner className='size-4 animate-spin text-primary motion-reduce:animate-none' /> : <BrainCircuit className='size-4 text-primary' />}
      <span className='shrink-0 font-medium text-foreground'>{t('stream.activity.thought')}</span>
      <span className='min-w-0 flex-1 truncate'>- {summary}</span>
      {duration && <span className='shrink-0 tabular-nums'>- {duration}</span>}
    </div>
  );
}

function ArtifactRow({ conversationId, messageId, data, enabled }: Readonly<{ conversationId: string; messageId: string; data: ArtifactActivityData; enabled: boolean }>) {
  const { t } = useModuleTranslation('conversation');
  const [loading, setLoading] = useState(false);
  const filename = sanitizeActivityFilename(data.filename) || t('stream.activity.generated');
  const open = async () => {
    if (!enabled || loading) return;
    setLoading(true);
    try {
      const { downloadUrl } = await getArtifactDownloadUrl(conversationId, messageId, data.artifactId);
      openFileViewerFromUrl(downloadUrl, filename, data.mimeType || 'application/octet-stream');
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className='flex items-center gap-3 rounded-lg border bg-background/50 px-3 py-2 text-sm'>
      <FileText className='size-4 text-primary' aria-hidden='true' />
      <span className='min-w-0 flex-1 truncate'>{filename}</span>
      <button type='button' disabled={!enabled || loading || data.availability !== 'ready'} onClick={open} className='font-medium text-primary disabled:text-muted-foreground'>{t('stream.activity.openArtifact')}</button>
    </div>
  );
}

export function ConversationAssistantBubble(props: Readonly<NarrativeProps>) {
  const { t } = useModuleTranslation('conversation');
  const useOriginalAnswer = !props.answerComponents || props.answerComponents === props.components;
  const source = useOriginalAnswer
    ? props.components
    : [...props.components.filter((component) => ['reasoning', 'toolInfo', 'artifact'].includes(component.type)), ...props.answerComponents!];
  const nodes: ReactNode[] = [];
  let answerBatch: MessageComponent[] = [];
  const flush = () => {
    if (!answerBatch.length) return;
    const parts = mapConversationComponentsToContentParts(answerBatch).map((part) =>
      part.type === 'text' ? { ...part, content: sanitizeAssistantDisplayText(part.content) } : part,
    );
    if (props.isStreaming && parts.at(-1)?.type === 'text') (parts.at(-1) as { showCursor?: boolean }).showCursor = true;
    if (parts.length) nodes.push(<AIMessageContent key={`answer-${nodes.length}`} parts={parts} isStreaming={props.isStreaming} onComponentAction={props.onComponentAction} onSubmitQuestions={props.onSubmitQuestions} choiceInteractions={props.choiceInteractions} taskDisplay='activity' />);
    answerBatch = [];
  };
  source.forEach((component, index) => {
    if (component.type === 'reasoning' || component.type === 'toolInfo' || component.type === 'artifact') {
      flush();
      if (component.type === 'reasoning') nodes.push(<ReasoningRow key={component.id || index} data={component.data as ReasoningActivityData} isStreaming={props.isStreaming} />);
      if (component.type === 'toolInfo') nodes.push(<ToolRow key={component.id || index} component={component} isStreaming={props.isStreaming} />);
      if (component.type === 'artifact') nodes.push(<ArtifactRow key={component.id || index} conversationId={props.conversationId} messageId={props.messageId} data={component.data as ArtifactActivityData} enabled={!props.isStreaming} />);
    } else answerBatch.push(component);
  });
  flush();
  if (!nodes.length && props.showWorking) nodes.push(<div key='working' className='flex items-center gap-2 text-sm text-muted-foreground'><Loader2 className='size-4 animate-spin text-primary motion-reduce:animate-none' />{t('stream.activity.usingTools')}</div>);
  if (!nodes.length) return null;
  const actorName = source.reduce<string>((name, component) => {
    if (component.type !== 'toolInfo') return name;
    const safeName = sanitizeActivityActorName((component.data as ToolActivityData).actorName);
    return safeName ? humanizeToolTitle(safeName) : name;
  }, '') || t('stream.activity.assistant');
  return (
    <div data-message-role='assistant' data-testid='conversation-assistant-bubble' className={cn('w-full rounded-2xl rounded-tl-sm border border-border/70 bg-muted/45 px-4 py-4 text-sm text-foreground shadow-xs dark:bg-muted/30')}>
      <div data-agent-activity data-active={props.isStreaming || undefined} className='mb-3 flex min-w-0 items-center gap-2 overflow-hidden text-sm text-muted-foreground' role={props.isStreaming ? 'status' : undefined}>
        <span className='relative flex size-8 shrink-0 items-center justify-center' aria-hidden='true'>
          {props.isStreaming && <Loader2 data-agent-spinner className='absolute size-7 animate-spin text-running [animation-duration:1.2s] motion-reduce:animate-none' />}
          <Bot className={cn('relative size-4', props.isStreaming && 'text-running')} />
        </span>
        <span className='shrink-0 font-medium text-foreground'>{actorName}</span>
        <span className={cn('relative h-0.5 min-w-8 flex-1 overflow-hidden', props.isStreaming ? 'bg-running/20' : 'bg-border')} aria-hidden='true'>
          {props.isStreaming && <span data-agent-scan className='absolute inset-y-0 left-0 w-1/3 animate-agent-scan bg-gradient-to-r from-transparent via-running to-transparent motion-reduce:animate-none' />}
        </span>
      </div>
      <div className='space-y-2'>{nodes}</div>
    </div>
  );
}
