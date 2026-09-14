import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Check, ChevronDown, ChevronRight, Download, Eye, FileText, Loader2 } from 'lucide-react';
import { AIMessageContent, type MarkdownHeadingInfo, type MessageContentPart } from '@/components/ai-elements/ai-message-content';
import { useAgentStore } from '@/modules/agent/store';
import type { Agent } from '@/modules/agent/types';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { showError } from '@/lib/notifications';
import { openFileViewerFromUrlLoader } from '@/modules/file-viewer';
import { useModuleTranslation } from '@/modules/localization';
import { getArtifactDownloadUrl } from '../../api';
import type { AgentActivityData, ArtifactActivityData, ChoiceInteractionMetadata, MessageComponent, ToolActivityData } from '../../types';
import { mapConversationComponentsToContentParts } from '../../utils';
import { formatActivityDuration, humanizeToolTitle, resolveToolFallbackName, resolveToolSummary, sanitizeActivityActorName, sanitizeActivityDetail, sanitizeActivityFilename, sanitizeActivitySummary, sanitizeAssistantDisplayText } from '../../utils/tool-activity';
import type { ChoiceComponentAction } from '@/components/ai-elements/choice/ChoicePartRenderer';
import { useConversationUiStore } from '../../uiStore';
import { ResizableActivityPane } from './ResizableActivityPane';
import { statusIcon, ToolRow } from './ToolActivityDetails';

interface NarrativeProps {
  conversationId: string;
  messageId: string;
  components: readonly MessageComponent[];
  answerComponents?: readonly MessageComponent[];
  isStreaming: boolean;
  showWorking?: boolean;
  /** True right after this message's stream completed: the pane starts open, then animates closed. */
  justCompleted?: boolean;
  choiceInteractions?: Map<string, ChoiceInteractionMetadata>;
  onComponentAction?: (action: ChoiceComponentAction) => Promise<void>;
  onSubmitQuestions?: (actions: ChoiceComponentAction[]) => Promise<void>;
  onRetry?: () => void;
  /** Agent that produced this message; when set with `onOpenAgentEditor`, the header bot icon opens the agent editor. */
  agentId?: string | null;
  onOpenAgentEditor?: (agentId: string) => void;
}

/** Grace period between answer completion and the animated pane collapse. */
const PANE_COLLAPSE_DELAY_MS = 900;

function collapseExactTandem(value: unknown): unknown {
  if (typeof value !== 'string' || value.length % 2 !== 0) return value;
  const midpoint = value.length / 2;
  return value.slice(0, midpoint) === value.slice(midpoint) ? value.slice(0, midpoint) : value;
}

function hasMeaningfulActivityText(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}

function countLexicalWords(value: string): number {
  return value.match(/[\p{L}\p{N}]+/gu)?.length || 0;
}

function isStandaloneActivityFragment(value: string): boolean {
  const first = value.trim().match(/[\p{L}\p{N}]/u)?.[0];
  return countLexicalWords(value) <= 3
    && Boolean(first)
    && (/\p{N}/u.test(first!) || /\p{Ll}/u.test(first!));
}

function resolveAgentActivityPreview(data: AgentActivityData, redactSensitiveText: boolean, fallback: string): string {
  const summary = sanitizeActivitySummary(data.summary, redactSensitiveText);
  const detail = sanitizeActivitySummary(data.detail, redactSensitiveText);
  const candidates = summary && summary.trim().split(/\s+/).length > 1 ? [summary, detail] : [detail, summary];
  return candidates.find((candidate) => candidate && hasMeaningfulActivityText(candidate)) || fallback;
}

function stripReasoningReplayPrefix(component: MessageComponent, reasoningTexts: readonly string[]): MessageComponent | undefined {
  if (component.type !== 'text' || typeof component.data.content !== 'string') return component;
  let content = component.data.content;
  let strippedReplayCount = 0;
  while (content) {
    content = content.trimStart();
    const replay = reasoningTexts.find((text) => content.startsWith(text));
    if (replay) {
      content = content.slice(replay.length);
      strippedReplayCount += 1;
      continue;
    }

    const truncatedReplayIndex = reasoningTexts.findIndex((text) => {
      const prefix = text.replace(/(?:\.{3}|…)$/, '').trimEnd();
      return prefix.length < text.length && content.startsWith(prefix);
    });
    if (truncatedReplayIndex < 0) break;

    const truncatedReplay = reasoningTexts[truncatedReplayIndex];
    const prefixLength = truncatedReplay.replace(/(?:\.{3}|…)$/, '').trimEnd().length;
    const nextReplayIndex = reasoningTexts.slice(truncatedReplayIndex + 1).reduce((earliest, text) => {
      const prefix = text.replace(/(?:\.{3}|…)$/, '').trimEnd();
      const index = prefix ? content.indexOf(prefix, prefixLength) : -1;
      return index >= 0 && (earliest < 0 || index < earliest) ? index : earliest;
    }, -1);
    const headingIndex = strippedReplayCount > 0
      ? content.slice(prefixLength).search(/(?<=[.!?])#{1,6}\s/)
      : -1;
    const answerIndex = headingIndex >= 0 ? prefixLength + headingIndex : -1;
    const boundary = [nextReplayIndex, answerIndex].filter((index) => index >= 0).sort((left, right) => left - right)[0];
    if (boundary === undefined) break;
    content = content.slice(boundary);
    strippedReplayCount += 1;
  }
  return content.trim() ? { ...component, data: { ...component.data, content } } : undefined;
}

function projectActivityComponents(components: MessageComponent[], redactSensitiveText: boolean): MessageComponent[] {
  return components.flatMap((component) => {
    if (component.type !== 'agentActivity') return [component];
    const data = component.data as AgentActivityData;
    const detail = collapseExactTandem(data.detail);
    const normalized: MessageComponent = { ...component, data: { ...data, detail } };
    const candidates = [data.summary, detail]
      .map((value) => sanitizeActivitySummary(value, redactSensitiveText))
      .filter((value): value is string => typeof value === 'string' && countLexicalWords(value) > 0);
    return candidates.length > 0 && candidates.every(isStandaloneActivityFragment) ? [] : [normalized];
  });
}

function resolveActivityDuration(components: readonly MessageComponent[]): string | undefined {
  const starts = components.map((component) => Date.parse(String(component.data.startedAt || ''))).filter(Number.isFinite);
  const ends = components.map((component) => Date.parse(String(component.data.completedAt || ''))).filter(Number.isFinite);
  if (starts.length && ends.length) {
    return formatActivityDuration(Math.max(...ends) - Math.min(...starts));
  }
  const durations = components.map((component) => Number(component.data.durationMs)).filter(Number.isFinite);
  return durations.length ? formatActivityDuration(Math.max(...durations)) : undefined;
}

function AgentActivityRow({ data, isStreaming, redactSensitiveText }: Readonly<{ data: AgentActivityData; isStreaming: boolean; redactSensitiveText: boolean }>) {
  const { t } = useModuleTranslation('conversation');
  const duration = formatActivityDuration(data.durationMs);
  const summary = resolveAgentActivityPreview(data, redactSensitiveText, t('stream.activity.agentPlanning'));
  const active = isStreaming && data.status === 'running';
  const statusLabel = t(`stream.activity.toolStatus.${data.status}`);
  const detail = sanitizeActivityDetail(data.detail, redactSensitiveText) || summary;
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <button type='button' aria-label={t('stream.activity.agentRowAria', { description: summary, status: statusLabel })} className='group flex min-h-7 w-full items-center gap-2 rounded-lg border border-transparent px-2 py-0.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:border-border/70 data-[state=open]:bg-muted/55'>
          <span data-agent-activity-spinner={active || undefined} aria-hidden='true'>{statusIcon(data.status, active)}</span>
          <span data-agent-summary className='min-w-0 flex-1 truncate font-medium leading-4 text-foreground'>{summary}</span>
          {duration && <span className='shrink-0 tabular-nums'>- {duration}</span>}
          <ChevronRight className='size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90' aria-hidden='true' />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className='px-1 pb-2 pt-1 sm:px-3'>
        <div data-agent-detail-card className='rounded-lg border border-border/70 bg-background/55 p-3 shadow-xs'>
          <p className='whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground'>{detail}</p>
        </div>
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
      await openFileViewerFromUrlLoader(
        JSON.stringify([conversationId, messageId, data.artifactId]),
        filename,
        data.mimeType || 'application/octet-stream',
        async () => {
          const { viewUrl } = await getArtifactDownloadUrl(conversationId, messageId, data.artifactId);
          return { url: viewUrl };
        },
      );
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
  const [open, setOpen] = useState(false);
  const contentId = useId();
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
    <Collapsible open={open} className='md:hidden'>
      <button type='button' aria-expanded={open} aria-controls={contentId} aria-label={t('stream.activity.mobileDetailsAria', { status: statusLabel })} onClick={() => setOpen((value) => !value)} className='flex min-h-11 w-full items-center gap-2 rounded-md px-1 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'>
        <span aria-hidden='true'>{statusIcon(status, current.type === 'toolActivity' ? true : isStreaming)}</span>
        <span className='min-w-0 flex-1 truncate text-muted-foreground'>{label}</span>
        <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>{t('stream.activity.stepProgress', { current: currentIndex + 1, total: components.length })}</span>
        <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden='true' />
      </button>
      <CollapsibleContent id={contentId} className='mt-2 space-y-2 border-t pt-2'>{nodes}</CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Value equality for projected content parts: unchanged parts keep the
 * previous object identity across drain ticks so memoized part renderers can
 * skip re-render (Phase 4 — immutable completed blocks).
 */
function sameContentPart(previous: MessageContentPart, next: MessageContentPart): boolean {
  if (previous.type !== next.type) return false;
  const left = previous as unknown as Record<string, unknown>;
  const right = next as unknown as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.is(left[key], right[key]));
}

function resolvePersistedHierarchyNames(
  component: MessageComponent,
  agents: readonly Agent[],
  delegationLabel: (name: string) => string,
): MessageComponent {
  if (component.type !== 'toolActivity') return component;
  const data = component.data as ToolActivityData;
  const actor = data.actorId && data.actorName === `agent_${data.actorId}`
    ? agents.find((agent) => agent.id === data.actorId)
    : undefined;
  const delegatedId = data.toolName?.startsWith('delegate_to_agent_')
    ? data.toolName.slice('delegate_to_agent_'.length)
    : undefined;
  const delegated = delegatedId ? agents.find((agent) => agent.id === delegatedId) : undefined;
  if (!actor && !delegated) return component;
  return {
    ...component,
    data: {
      ...data,
      ...(actor ? { actorName: actor.name } : {}),
      ...(delegated ? { fallbackDisplayName: delegationLabel(delegated.name) } : {}),
    },
  };
}

export function ConversationAssistantBubble(props: Readonly<NarrativeProps>) {
  const { t } = useModuleTranslation('conversation');
  const navigate = useNavigate();
  const agents = useAgentStore((state) => state.agents);
  const agentDirectoryInitialized = useAgentStore((state) => state.isInitialized);
  const activityPaneRef = useRef<HTMLDivElement>(null);
  const redactSensitiveText = false;
  const messageId = props.messageId;

  // Stable on purpose: agent lookup reads the store at click time, so the
  // memoized AIMessageContent never needs to re-render for this callback.
  const handleOpenAgentEditor = useCallback((task: { title: string; agentId?: string }) => {
    const agents = useAgentStore.getState().agents;
    const byId = task.agentId ? agents.find((agent) => agent.id === task.agentId) : undefined;
    const byName = agents.find((agent) => agent.name.trim().toLowerCase() === task.title.trim().toLowerCase());
    const resolved = byId ?? byName;
    navigate(resolved ? `/agents?edit=${resolved.id}` : '/agents');
  }, [navigate]);

  // The activity pane stays open while the agent works, then collapses once
  // the final answer is complete — live via `justCompleted`, which mounts the
  // completed bubble open and animates it shut, and statically for historical
  // messages, which render collapsed from the start.
  const [paneCollapsed, setPaneCollapsed] = useState(!props.isStreaming && props.justCompleted !== true);
  useEffect(() => {
    if (props.justCompleted !== true) return;
    const timer = setTimeout(() => setPaneCollapsed(true), PANE_COLLAPSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [props.justCompleted]);

  // Document outline: merge headings reported by each rendered answer chunk and
  // publish them keyed by message id; clear on unmount or message swap. The set
  // of live answer-batch keys is rebuilt every render: publishOutline prunes
  // keys that no longer exist, and the signature effect re-publishes when the
  // batch layout changes, so headings from vanished answer chunks (or a whole
  // answer replaced by activity-only content) never linger.
  const outlinePartsRef = useRef(new Map<number, MarkdownHeadingInfo[]>());
  const liveOutlineKeysRef = useRef(new Set<number>());
  liveOutlineKeysRef.current = new Set<number>();
  const publishOutline = useCallback(() => {
    for (const key of [...outlinePartsRef.current.keys()]) {
      if (!liveOutlineKeysRef.current.has(key)) outlinePartsRef.current.delete(key);
    }
    const merged = [...outlinePartsRef.current.entries()].sort(([a], [b]) => a - b).flatMap(([, headings]) => headings);
    useConversationUiStore.getState().setOutlineHeadings(messageId, merged);
  }, [messageId]);
  const registerOutlinePart = useCallback((partKey: number, headings: MarkdownHeadingInfo[]) => {
    outlinePartsRef.current.set(partKey, headings);
    publishOutline();
  }, [publishOutline]);
  useEffect(() => {
    return () => {
      useConversationUiStore.getState().clearOutlineHeadings(messageId);
    };
  }, [messageId]);
  const useOriginalAnswer = !props.answerComponents || props.answerComponents === props.components;
  const source = useOriginalAnswer
    ? props.components
    : [...props.components.filter((component) => ['agentActivity', 'toolActivity', 'artifact'].includes(component.type)), ...props.answerComponents!];
  useEffect(() => {
    if (agentDirectoryInitialized) return;
    const unresolvedHierarchyId = source.some((component) => {
      if (component.type !== 'toolActivity') return false;
      const data = component.data as ToolActivityData;
      const actorId = data.actorName === `agent_${data.actorId}` ? data.actorId : undefined;
      const delegatedId = data.toolName?.startsWith('delegate_to_agent_')
        ? data.toolName.slice('delegate_to_agent_'.length)
        : undefined;
      return [actorId, delegatedId].some((id) => id && !agents.some((agent) => agent.id === id));
    });
    if (!unresolvedHierarchyId) return;
    void useAgentStore.getState().fetchAgents().catch((error) => {
      console.error('Failed to load agent names for conversation activity', error);
    });
  }, [agentDirectoryInitialized, agents, source]);
  const activityNodes: ReactNode[] = [];
  const answerNodes: ReactNode[] = [];
  const activityComponents = projectActivityComponents(source.filter(
    (component): component is MessageComponent & { type: 'agentActivity' | 'toolActivity' | 'artifact' } =>
      component.type === 'agentActivity' || component.type === 'toolActivity' || component.type === 'artifact',
  ).map((component) => resolvePersistedHierarchyNames(
    component,
    agents,
    (name) => t('stream.activity.delegateTo', { name }),
  )), redactSensitiveText);
  const activityCount = activityComponents.length;
  const activityDuration = resolveActivityDuration(activityComponents);
  const reasoningTexts = [...new Set(activityComponents.flatMap((component) => {
    if (component.type !== 'agentActivity') return [];
    const detail = collapseExactTandem(component.data.detail);
    return [detail, component.data.summary]
      .filter((text): text is string => typeof text === 'string' && text.trim().split(/\s+/).length > 1)
      .map((text) => text.trim());
  }))];
  useEffect(() => {
    if (paneCollapsed) return;
    const pane = activityPaneRef.current;
    if (pane) pane.scrollTop = pane.scrollHeight;
  }, [activityCount, paneCollapsed]);
  let answerBatch: MessageComponent[] = [];
  const partsCacheRef = useRef(new Map<number, MessageContentPart>());
  const flush = () => {
    if (!answerBatch.length) return;
    const previousParts = partsCacheRef.current;
    const nextCache = new Map<number, MessageContentPart>();
    const parts = mapConversationComponentsToContentParts(answerBatch).map((part, index) => {
      const base = part.type === 'text' ? { ...part, content: sanitizeAssistantDisplayText(part.content, redactSensitiveText) } : part;
      const previous = previousParts.get(index);
      // Reuse the previous identity when nothing changed so the memoized
      // AIMessagePart subtree can skip re-render for completed parts.
      const stable = previous !== undefined && sameContentPart(previous, base) ? previous : base;
      nextCache.set(index, stable);
      return stable;
    });
    partsCacheRef.current = nextCache;
    if (props.isStreaming && parts.at(-1)?.type === 'text') (parts.at(-1) as { showCursor?: boolean }).showCursor = true;
    if (parts.length) {
      const outlinePartKey = answerNodes.length;
      liveOutlineKeysRef.current.add(outlinePartKey);
      answerNodes.push(<AIMessageContent key={`answer-${outlinePartKey}`} parts={parts} isStreaming={props.isStreaming} onComponentAction={props.onComponentAction} onSubmitQuestions={props.onSubmitQuestions} choiceInteractions={props.choiceInteractions} taskDisplay='activity' onTaskAgentClick={handleOpenAgentEditor} citationScope={{ conversationId: props.conversationId, messageId: props.messageId }} onOutlineHeadings={(headings) => registerOutlinePart(outlinePartKey, headings)} />);
    }
    answerBatch = [];
  };
  source.forEach((component) => {
    if (['agentActivity', 'toolActivity', 'artifact'].includes(component.type)) return;
    const projected = stripReasoningReplayPrefix(component, reasoningTexts);
    if (projected) answerBatch.push(projected);
  });
  flush();
  // Reconcile the published snapshot whenever the set of live answer chunks
  // changes (e.g. an answer replaced by activity-only content).
  const liveOutlineSignature = [...liveOutlineKeysRef.current].sort((a, b) => a - b).join(',');
  useEffect(() => {
    publishOutline();
  }, [liveOutlineSignature, publishOutline]);
  activityComponents.forEach((component, index) => {
    if (component.type === 'agentActivity') activityNodes.push(<AgentActivityRow key={component.id || index} data={component.data as AgentActivityData} isStreaming={props.isStreaming} redactSensitiveText={redactSensitiveText} />);
    if (component.type === 'toolActivity') {
      activityNodes.push(<ToolRow key={component.id || index} conversationId={props.conversationId} messageId={props.messageId} component={component} redactSensitiveText={redactSensitiveText} onRetry={props.onRetry} />);
    }
    if (component.type === 'artifact') activityNodes.push(<ArtifactRow key={component.id || index} conversationId={props.conversationId} messageId={props.messageId} data={component.data as ArtifactActivityData} enabled={!props.isStreaming} />);
  });
  if (!activityNodes.length && props.showWorking) activityNodes.push(<div key='working' className='flex items-center gap-2 text-sm text-muted-foreground'><Loader2 className='size-4 animate-spin text-primary' />{t('stream.activity.usingTools')}</div>);
  if (!activityNodes.length && !answerNodes.length) return null;
  const actorName = activityComponents.reduce<string>((name, component) => {
    if (component.type !== 'toolActivity') return name;
    const safeName = sanitizeActivityActorName((component.data as ToolActivityData).actorName);
    return safeName ? humanizeToolTitle(safeName) : name;
  }, '') || t('stream.activity.assistant');
  const openAgentEditor = props.agentId && props.onOpenAgentEditor
    ? () => props.onOpenAgentEditor!(props.agentId!)
    : null;
  const agentIcon = openAgentEditor ? (
    <button
      type='button'
      data-agent-editor-trigger
      onClick={openAgentEditor}
      aria-label={t('stream.activity.openAgentEditor')}
      title={t('stream.activity.openAgentEditor')}
      className='relative flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
    >
      {props.isStreaming && <Loader2 data-agent-spinner className='absolute size-7 animate-spin text-running [animation-duration:1.2s]' />}
      <Bot className={cn('relative size-4', props.isStreaming && 'text-running')} />
    </button>
  ) : (
    <span className='relative flex size-8 shrink-0 items-center justify-center' aria-hidden='true'>
      {props.isStreaming && <Loader2 data-agent-spinner className='absolute size-7 animate-spin text-running [animation-duration:1.2s]' />}
      <Bot className={cn('relative size-4', props.isStreaming && 'text-running')} />
    </span>
  );
  return (
    <div data-message-role='assistant' data-testid='conversation-assistant-bubble' className={cn('w-full rounded-2xl rounded-tl-sm border border-border/70 bg-muted/45 px-4 py-4 text-sm text-foreground shadow-xs dark:bg-muted/30')}>
        {activityNodes.length > 0 ? <>
          {props.isStreaming ? (
            <div data-agent-activity data-active className='mb-3 hidden min-w-0 w-full items-center gap-2 overflow-hidden text-sm text-muted-foreground md:flex'>
              {agentIcon}
              <span className='shrink-0 font-medium text-foreground'>{actorName}</span>
              <span className='sr-only' role='status'>{actorName}</span>
              <span className='relative h-0.5 min-w-8 flex-1 overflow-hidden bg-running/20' aria-hidden='true'>
                <span data-agent-scan className='absolute inset-y-0 left-0 w-1/3 animate-agent-scan bg-gradient-to-r from-transparent via-running to-transparent' />
              </span>
              <button
                type='button'
                data-activity-pane-toggle
                aria-expanded={!paneCollapsed}
                aria-label={paneCollapsed ? t('stream.activity.paneExpand') : t('stream.activity.paneCollapse')}
                title={paneCollapsed ? t('stream.activity.paneExpand') : t('stream.activity.paneCollapse')}
                onClick={() => setPaneCollapsed((value) => !value)}
                className='inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              >
                <ChevronDown className={cn('size-4 transition-transform', paneCollapsed && '-rotate-90')} aria-hidden='true' />
              </button>
            </div>
          ) : (
            <button
              type='button'
              data-agent-activity
              data-activity-pane-toggle
              aria-expanded={!paneCollapsed}
              aria-label={paneCollapsed ? t('stream.activity.paneExpand') : t('stream.activity.paneCollapse')}
              title={paneCollapsed ? t('stream.activity.paneExpand') : t('stream.activity.paneCollapse')}
              onClick={() => setPaneCollapsed((value) => !value)}
              className='mb-3 hidden min-h-11 w-full min-w-0 items-center gap-2 rounded-md px-1 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex'
            >
              <span className='flex size-8 shrink-0 items-center justify-center' aria-hidden='true'><Bot className='size-4' /></span>
              <span className='shrink-0 font-medium text-foreground'>{actorName}</span>
              <span className='h-0.5 min-w-8 flex-1 bg-border' aria-hidden='true' />
              <Check className='size-4 shrink-0 text-green-500' aria-hidden='true' />
              <span className='shrink-0 text-xs'>{activityDuration ? t('stream.activity.completedIn', { duration: activityDuration }) : t('stream.activity.toolStatus.completed')}</span>
              <span aria-hidden='true'>·</span>
              <span className='shrink-0 text-xs tabular-nums'>{t(activityCount === 1 ? 'stream.activity.stepCount_one' : 'stream.activity.stepCount_other', { count: activityCount })}</span>
              <span className='shrink-0 text-xs font-medium text-foreground'>{t('stream.activity.viewProcess')}</span>
              <ChevronDown className={cn('size-4 shrink-0 transition-transform', paneCollapsed && '-rotate-90')} aria-hidden='true' />
            </button>
          )}
        <div data-agent-activity-mobile data-active={props.isStreaming || undefined} className='mb-3 flex min-w-0 items-center gap-2 overflow-hidden text-sm text-muted-foreground md:hidden' role={props.isStreaming ? 'status' : undefined}>
          {agentIcon}
          <span className='shrink-0 font-medium text-foreground'>{actorName}</span>
          <span className={cn('relative h-0.5 min-w-8 flex-1 overflow-hidden', props.isStreaming ? 'bg-running/20' : 'bg-border')} aria-hidden='true'>
            {props.isStreaming && <span data-agent-scan className='absolute inset-y-0 left-0 w-1/3 animate-agent-scan bg-gradient-to-r from-transparent via-running to-transparent' />}
          </span>
        </div>
        </> : (
          <div data-agent-activity data-active={props.isStreaming || undefined} className='mb-3 flex min-w-0 items-center gap-2 overflow-hidden text-sm text-muted-foreground' role={props.isStreaming ? 'status' : undefined}>
            {agentIcon}
            <span className='shrink-0 font-medium text-foreground'>{actorName}</span>
            <span className={cn('relative h-0.5 min-w-8 flex-1 overflow-hidden', props.isStreaming ? 'bg-running/20' : 'bg-border')} aria-hidden='true'>
              {props.isStreaming && <span data-agent-scan className='absolute inset-y-0 left-0 w-1/3 animate-agent-scan bg-gradient-to-r from-transparent via-running to-transparent' />}
            </span>
          </div>
        )}
      {activityComponents.length > 0
        ? <MobileActivityTimeline components={activityComponents} nodes={activityNodes} isStreaming={props.isStreaming} />
        : props.showWorking && <div data-mobile-working className='flex items-center gap-2 text-sm text-muted-foreground md:hidden'><Loader2 className='size-4 animate-spin text-primary' />{t('stream.activity.usingTools')}</div>}
      {activityNodes.length > 0 && (
        <div
          data-activity-pane-shell
          data-collapsed={paneCollapsed || undefined}
          className='grid transition-[grid-template-rows] duration-300 ease-in-out motion-reduce:transition-none'
          style={{ gridTemplateRows: paneCollapsed ? '0fr' : '1fr' }}
        >
          <div className={cn('min-h-0 overflow-hidden transition-[visibility] duration-300 motion-reduce:transition-none', paneCollapsed && 'invisible')}>
            <ResizableActivityPane paneRef={activityPaneRef} resizeLabel={t('stream.activity.resizePaneAria')}>
              <div data-desktop-activity>{activityNodes}</div>
            </ResizableActivityPane>
          </div>
        </div>
      )}
      {answerNodes.length > 0 && <div data-answer-content className={cn('space-y-2', activityNodes.length > 0 && 'mt-4 border-t pt-4')}>{answerNodes}</div>}
    </div>
  );
}
