'use client';

import { cn } from '@/lib/utils';
import { downloadCode } from '@/lib/download';
import { toast } from 'sonner';
import { useState, useMemo, useCallback, useEffect, useRef, type HTMLAttributes } from 'react';
import { useShouldAutoOpenPreview, useFileViewerDisplayMode } from './message-context';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeArtifact } from './code-artifact';
import { Reasoning, ReasoningTrigger, ReasoningContent } from './reasoning';
import { Queue, QueueSection, QueueSectionTrigger, QueueSectionLabel, QueueSectionContent, QueueList, QueueItem, QueueItemIndicator, QueueItemContent } from './queue';
import { Plan, PlanHeader, PlanTitle, PlanDescription, PlanContent, PlanFooter } from './plan';
import { Checkpoint, CheckpointIcon, CheckpointTrigger } from './checkpoint';
import { Task, TaskTrigger, TaskContent, TaskItem, TaskDiagnosticsTrigger } from './task';
import { Tool, ToolHeader, ToolContent, ToolInput } from './tool';
import type { ToolUIPart } from 'ai';
import { ChainOfThought, ChainOfThoughtHeader, ChainOfThoughtContent, ChainOfThoughtStep } from './chain-of-thought';
import { Sources, SourcesTrigger, SourcesContent, Source } from './sources';
import { Sandbox, SandboxHeader, SandboxContent, SandboxTabs, SandboxTabsBar, SandboxTabsList, SandboxTabsTrigger, SandboxTabContent, type SandboxState } from './sandbox';
import { WebPreview, WebPreviewNavigation, WebPreviewBody, isolateGeneratedPreviewHtml } from './web-preview';
import { InlineCitation, InlineCitationCard, InlineCitationCardTrigger, InlineCitationCardBody, InlineCitationCarousel, InlineCitationCarouselContent, InlineCitationCarouselItem, InlineCitationSource, InlineCitationQuote } from './inline-citation';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PlayIcon, CheckCircle2, Circle, ListTodo, AlertTriangle, Loader2, Bot, Eye, Download, FileText, XCircle, Maximize, Minimize } from 'lucide-react';
import type { BundledLanguage } from 'shiki';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Label, Line, LineChart, Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from 'recharts';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import type { ChartConfig } from '@/components/ui/chart';
import type { ChartComponentData } from '@/modules/conversation/types';
import type { ChoiceComponentData, ChoiceInteractionMetadata } from '@/modules/conversation/types';
import { ChoicePartRenderer, type ChoiceComponentAction } from './choice/ChoicePartRenderer';
import { useModuleTranslation } from '@/modules/localization';
import { isViewableFilename } from '@/modules/file-viewer/renderers';
import { Separator } from '../ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { rehypeCitationMarkers } from '@/lib/rehype-citation-markers';
import { remarkAssistantCitationLinks } from '@/lib/remark-assistant-citation-links';

// ============================================================================
// Message Content Part Types
// ============================================================================

export type CitationBBox = [number, number, number, number];

export interface CitationData {
  parentId: string;
  sourceType: 'text' | 'image';
  source: string;
  externalId: string;
  page: string;
  pageContent: string;
  workspaceId: string;
  reference?: string;
  path?: string;
  height?: string;
  width?: string;
  highlightText?: string;
  highlightBBox?: CitationBBox;
  blockBBox?: CitationBBox;
}

export interface TextPart {
  type: 'text';
  content: string;
  showCursor?: boolean;
  citations?: CitationData[];
}

export interface CodePart {
  type: 'code';
  content: string;
  language: string;
  filename?: string;
}

export interface ReasoningPart {
  type: 'reasoning';
  content: string;
  duration?: number;
}

export interface QueueItemData {
  id: string;
  title: string;
  status: 'pending' | 'completed' | 'active';
}

export interface QueuePart {
  type: 'queue';
  title?: string;
  items: QueueItemData[];
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'error';

export interface PlanStepData {
  task: string;
  agent: string;
  status: TaskStatus;
}

export interface PlanPart {
  type: 'plan';
  title: string;
  description: string;
  steps?: PlanStepData[];
  status?: TaskStatus;
}

export interface CheckpointPart {
  type: 'checkpoint';
  label: string;
}

export interface ChartPart extends ChartComponentData {
  type: 'chart';
}
export interface ChoicePart extends ChoiceComponentData { type: 'choice'; componentId: string; }

export interface TaskPart {
  type: 'task';
  title: string;
  items: string[];
  status?: 'pending' | 'in_progress' | 'completed';
}

export interface ErrorPart {
  type: 'error';
  title: string;
  content: string;
}

export interface SourceItemData {
  title: string;
  url: string;
}

export interface SourcesPart {
  type: 'sources';
  sources: SourceItemData[];
}

export interface SandboxPart {
  type: 'sandbox';
  code: string;
  output: string;
  error: string;
  outputAvailable: boolean;
}

export interface WebPreviewPart {
  type: 'webPreview';
  content: string;
}

export interface ArtifactPart {
  type: 'artifact';
  filePath: string;
  filename: string;
}

export interface CitationPart {
  type: 'citation';
  parentId: string;
  sourceType: 'text' | 'image';
  source: string;
  externalId: string;
  page: string;
  pageContent: string;
  workspaceId: string;
  reference?: string;
  path?: string;
  height?: string;
  width?: string;
  highlightText?: string;
  highlightBBox?: CitationBBox;
  blockBBox?: CitationBBox;
}

export interface ToolInfoPart {
  type: 'toolInfo';
  title: string;
  status: 'running' | 'completed' | 'failed';
  /** JSON string of the tool-call arguments, e.g. '{"query":"..."}'. */
  params?: string;
  startedAt?: string;
}

export interface ChainOfThoughtPart {
  type: 'chainOfThought';
  /** Ordered step titles, shown as a collapsed list on top of the response. */
  steps: string[];
}

export type MessageContentPart = TextPart | CodePart | ReasoningPart | QueuePart | PlanPart | CheckpointPart | ChartPart | ChoicePart | TaskPart | ErrorPart | SourcesPart | SandboxPart | WebPreviewPart | ArtifactPart | CitationPart | ToolInfoPart | ChainOfThoughtPart;

// ============================================================================
// AIMessageContent Component
// ============================================================================

export type AIMessageContentProps = HTMLAttributes<HTMLDivElement> & {
  parts: MessageContentPart[];
  /** Whether the message is currently streaming. Affects default open state of collapsible components. */
  isStreaming?: boolean;
  onComponentAction?: (action: ChoiceComponentAction) => Promise<void>;
  choiceInteractions?: Map<string, ChoiceInteractionMetadata>;
  taskDisplay?: 'raw' | 'activity';
  showTaskDiagnostics?: boolean;
};

type TaskActivityStep = {
  label: string;
  status?: ToolInfoPart['status'];
};

function safeActivityLabel(value: string): string | null {
  const label = value.replace(/\s+/g, ' ').trim();
  if (!label || label.length > 160 || /[<>]/.test(label)) return null;
  return label;
}

function formatActivityLabel(value: string): string {
  return /[_-]/.test(value) ? formatLabel(value) : value;
}

function buildTaskActivity(parts: MessageContentPart[]): TaskActivityStep[] {
  const tools = parts.filter((part): part is ToolInfoPart => {
    if (part.type !== 'toolInfo') return false;
    const title = safeActivityLabel(part.title);
    return Boolean(title && /^[A-Za-z][A-Za-z0-9_. -]{0,119}$/.test(title) && redactDiagnosticText(title) === title);
  });
  const toolByLabel = new Map(tools.map((tool) => [formatLabel(tool.title).toLowerCase(), tool]));
  const activity: TaskActivityStep[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    if (part.type !== 'chainOfThought') continue;
    for (const rawStep of part.steps) {
      const safeStep = safeActivityLabel(rawStep);
      if (!safeStep) continue;
      const label = formatActivityLabel(safeStep);
      const key = label.toLowerCase();
      const tool = toolByLabel.get(key);
      if (!tool) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      activity.push({ label, status: tool.status });
    }
  }

  for (const tool of tools) {
    const label = formatLabel(tool.title);
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    activity.push({ label, status: tool.status });
  }

  return activity.slice(0, 20);
}

function redactDiagnosticText(value: string): string {
  return value
    .slice(0, 30_000)
    .replace(/(authorization\s*:\s*)(?:bearer|basic)\s+[^\s<]+/gi, '$1[REDACTED]')
    .replace(/(cookie\s*:\s*)[^\r\n<]+/gi, '$1[REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+@/gi, '$1[REDACTED]@')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|passwd|secret|client[_-]?secret|connection[_-]?string)\s*["']?\s*[:=]\s*["']?)[^\s"',}<;&]+/gi, '$1[REDACTED]');
}

/**
 * AIMessageContent - Renders structured AI message content using ai-sdk components
 */
export const AIMessageContent = ({ parts, className, isStreaming = false, onComponentAction, choiceInteractions, taskDisplay = 'raw', showTaskDiagnostics = true, ...props }: AIMessageContentProps) => {
  const choicePrompts = new Set(parts.filter((part): part is ChoicePart => part.type === 'choice' && part.status === 'ready').map((part) => part.prompt.trim()).filter(Boolean));
  const hasTask = parts.some((part) => part.type === 'task');
  const taskActivity = useMemo(() => buildTaskActivity(parts), [parts]);
  const visibleParts = parts.filter((part) => {
    if (part.type === 'text' && choicePrompts.has(part.content.trim())) return false;
    return !(taskDisplay === 'activity' && hasTask && (part.type === 'chainOfThought' || part.type === 'toolInfo'));
  });

  return (
    <div className={cn('space-y-4', className)} {...props}>
      {visibleParts.map((part, index) => (
        <AIMessagePart key={part.type === 'choice' ? `choice:${part.componentId}` : index} part={part} isStreaming={isStreaming} onComponentAction={onComponentAction} choiceInteractions={choiceInteractions} taskDisplay={taskDisplay} taskActivity={taskActivity} showTaskDiagnostics={showTaskDiagnostics} />
      ))}
    </div>
  );
};

// ============================================================================
// Individual Part Renderers
// ============================================================================

type AIMessagePartProps = {
  part: MessageContentPart;
  isStreaming?: boolean;
  onComponentAction?: (action: ChoiceComponentAction) => Promise<void>;
  choiceInteractions?: Map<string, ChoiceInteractionMetadata>;
  taskDisplay?: 'raw' | 'activity';
  taskActivity?: TaskActivityStep[];
  showTaskDiagnostics?: boolean;
};

const AIMessagePart = ({ part, isStreaming = false, onComponentAction, choiceInteractions, taskDisplay = 'raw', taskActivity = [], showTaskDiagnostics = true }: AIMessagePartProps) => {
  switch (part.type) {
    case 'text':
      return <TextPartRenderer content={part.content} showCursor={part.showCursor} citations={part.citations} />;
    case 'code':
      return <CodePartRenderer content={part.content} language={part.language} filename={part.filename} />;
    case 'reasoning':
      return <ReasoningPartRenderer content={part.content} duration={part.duration} isStreaming={isStreaming} />;
    case 'queue':
      return <QueuePartRenderer title={part.title} items={part.items} isStreaming={isStreaming} />;
    case 'plan':
      return <PlanPartRenderer title={part.title} description={part.description} steps={part.steps} status={part.status} isStreaming={isStreaming} />;
    case 'checkpoint':
      return <CheckpointPartRenderer label={part.label} />;
    case 'chart':
      return <ChartPartRenderer type='chart' kind={part.kind} title={part.title} data={part.data} config={part.config} xAxisKey={part.xAxisKey} yAxisKey={part.yAxisKey} nameKey={part.nameKey} zAxisKey={part.zAxisKey} stacked={part.stacked} layout={part.layout} innerRadius={part.innerRadius} showLegend={part.showLegend} showGrid={part.showGrid} series={part.series} />;
    case 'choice':
      return <ChoicePartRenderer {...part} onAction={onComponentAction} submittedInteraction={choiceInteractions?.get(part.componentId)} externallyDisabled={isStreaming} />;
    case 'task':
      return <TaskPartRenderer title={part.title} items={part.items} status={part.status} isStreaming={isStreaming} activity={taskDisplay === 'activity' ? taskActivity : undefined} showDiagnostics={showTaskDiagnostics} />;
    case 'error':
      return <ErrorPartRenderer title={part.title} content={part.content} />;
    case 'sources':
      return <SourcesPartRenderer sources={part.sources} />;
    case 'sandbox':
      return <SandboxPartRenderer code={part.code} output={part.output} error={part.error} outputAvailable={part.outputAvailable} />;
    case 'webPreview':
      return <WebPreviewPartRenderer content={part.content} />;
    case 'artifact':
      return <ArtifactPartRenderer filePath={part.filePath} filename={part.filename} />;
    case 'citation':
      return <CitationPartRenderer citation={part} />;
    case 'toolInfo':
      return <ToolInfoPartRenderer title={part.title} status={part.status} params={part.params} />;
    case 'chainOfThought':
      return <ChainOfThoughtPartRenderer steps={part.steps} />;
    default:
      return null;
  }
};

// Shared markdown component overrides (extracted to avoid duplication)
const markdownComponents: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  code({ children, ...props }) {
    return (
      <code className='bg-muted px-1.5 py-0.5 rounded text-sm' {...props}>
        {children}
      </code>
    );
  },
  pre({ children }) {
    return <pre className='bg-muted rounded-md p-3 overflow-x-auto my-4 text-sm'>{children}</pre>;
  },
  a({ children, ...props }) {
    return (
      <a className='inline-flex items-center gap-1 rounded-full bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors' target='_blank' rel='noopener noreferrer' {...props}>
        {children}
      </a>
    );
  },
  p({ children }) {
    return <p className='my-0 leading-relaxed'>{children}</p>;
  },
  ul({ children }) {
    return <ul className='my-2 list-disc pl-5 space-y-1'>{children}</ul>;
  },
  ol({ children }) {
    return <ol className='my-2 list-decimal pl-5 space-y-1'>{children}</ol>;
  },
  li({ children }) {
    return <li className='my-0 leading-relaxed'>{children}</li>;
  },
  h1({ children }) {
    return <h1 className='text-xl font-bold mb-3 mt-6 first:mt-0'>{children}</h1>;
  },
  h2({ children }) {
    return <h2 className='text-lg font-bold mb-3 mt-5 first:mt-0'>{children}</h2>;
  },
  h3({ children }) {
    return <h3 className='text-base font-bold mb-2 mt-4 first:mt-0'>{children}</h3>;
  },
  hr() {
    return <hr className='my-8 border-t-2 border-muted-foreground/80' />;
  },
  blockquote({ children }) {
    return <blockquote className='border-l-4 border-muted-foreground/30 pl-4 italic my-4'>{children}</blockquote>;
  },
  table({ children }) {
    return (
      <div className='overflow-x-auto my-4'>
        <table className='min-w-full border-collapse border border-border'>{children}</table>
      </div>
    );
  },
  th({ children }) {
    return <th className='border border-border bg-muted px-3 py-2 text-left font-semibold'>{children}</th>;
  },
  td({ children }) {
    return <td className='border border-border px-3 py-2'>{children}</td>;
  },
};

const remarkPlugins = [remarkGfm, remarkAssistantCitationLinks];
const rehypeCitationPlugins = [rehypeCitationMarkers];

function normalizeCitationReference(reference?: string): string | undefined {
  return reference?.trim().replace(/^\[|\]$/g, '').trim() || undefined;
}

function getCitationTriggerLabel(citation: CitationData, fallback: string): string {
  return normalizeCitationReference(citation.reference) || citation.source || fallback;
}

// Text Part with Markdown support
const TextPartRenderer = ({ content, showCursor, citations }: { content: string; showCursor?: boolean; citations?: CitationData[] }) => {
  // Split citations: those with a reference AND a matching [n] marker in the text are inline
  // (rendered at [n] positions by rehype), all others are trailing (rendered as badges after text).
  // This ensures citations with a reference but no matching marker are not silently lost.
  const { citationMap, trailingCitations } = useMemo(() => {
    if (!citations || citations.length === 0) {
      return { citationMap: new Map<string, CitationData>(), trailingCitations: [] as CitationData[] };
    }
    const map = new Map<string, CitationData>();
    const trailing: CitationData[] = [];
    for (const c of citations) {
      // Normalize reference to bare digit (e.g. "[1]" → "1") to match rehypeCitationMarkers output
      const ref = normalizeCitationReference(c.reference);
      if (ref && content.includes(`[${ref}]`)) {
        map.set(ref, c);
      } else {
        trailing.push(c);
      }
    }
    return { citationMap: map, trailingCitations: trailing };
  }, [citations, content]);

  const hasInline = citationMap.size > 0;
  const hasTrailing = trailingCitations.length > 0;

  // Stable ref for citation map to use in the cite component without re-creating components object
  const citationMapRef = useRef(citationMap);
  citationMapRef.current = citationMap;

  // Build components with cite handler for inline citations
  const componentsWithCite = useMemo(() => {
    if (!hasInline) return markdownComponents;
    return {
      ...markdownComponents,
      cite: ({ node, ...props }: any) => {
        const ref = props['data-citation-ref'] as string | undefined;
        if (ref == null) return null;
        const c = citationMapRef.current.get(ref);
        if (!c) return <>[{ref}]</>;
        return <SingleInlineCitation citation={c} />;
      },
    };
  }, [hasInline]);

  return (
    <div className={cn(showCursor && "[&>*:last-child]:after:content-[''] [&>*:last-child]:after:inline-block [&>*:last-child]:after:w-[3px] [&>*:last-child]:after:h-4 [&>*:last-child]:after:bg-foreground [&>*:last-child]:after:ml-0.5 [&>*:last-child]:after:animate-pulse [&>*:last-child]:after:align-text-bottom", hasTrailing && '[&>*:nth-last-child(2)]:not(:where(ul, ol, pre)):inline [&>*:nth-last-child(2)]:not(:where(ul, ol, pre)):mb-0')}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={hasInline ? rehypeCitationPlugins : undefined} components={componentsWithCite}>
        {content}
      </ReactMarkdown>
      {hasTrailing && <CitationsInline citations={trailingCitations} />}
    </div>
  );
};

// Single inline citation badge rendered at a marker position within text
// Resolve a citation to a signed URL via the path-signer endpoint and open it.
// Image citations carry `path`; text citations carry the path in `source` (the
// proto comment calling it a filename is misleading — it's the object key).
async function openCitationSource(
  c: CitationData,
  displayMode: ReturnType<typeof useFileViewerDisplayMode>,
  defaultLabel: string,
): Promise<void> {
  const { openFileViewerFromUrl, getMimeTypeFromFilename } = await import('@/modules/file-viewer');

  const objectKey = (c.sourceType === 'image' ? c.path : c.source) || '';
  if (!objectKey) return;

  // Display name = the proto-provided filename when present; otherwise the
  // basename of the object key. Falls back to the i18n default label so the
  // viewer tab always has *some* title.
  const displayName =
    (c.sourceType === 'image' ? c.source : '') ||
    objectKey.split('/').pop() ||
    defaultLabel;
  const mimeType = getMimeTypeFromFilename(displayName) ?? 'application/octet-stream';
  const numbers = c.page?.match(/\d+/g);
  const page = numbers?.length ? parseInt(numbers[numbers.length - 1], 10) : undefined;

  const { getArtifactDownloadUrl } = await import('@/modules/conversation/api');
  const { downloadUrl } = await getArtifactDownloadUrl(objectKey, displayName);
  openFileViewerFromUrl(downloadUrl, displayName, mimeType, {
    displayMode,
    closeOnOutsideClick: displayMode === 'floating',
    page,
    highlightText: c.highlightText || c.pageContent || undefined,
    highlightBBox: c.highlightBBox || c.blockBBox,
  });
}

const SingleInlineCitation = ({ citation: c }: { citation: CitationData }) => {
  const { t: tCommon } = useModuleTranslation('common');
  const fileViewerDisplayMode = useFileViewerDisplayMode();

  const handleClick = useCallback(async () => {
    try {
      await openCitationSource(c, fileViewerDisplayMode, tCommon('ai.citations.defaultSource'));
    } catch (error) {
      console.error('Failed to open citation source:', error);
      toast.error(tCommon('ai.errors.openFileTitle'), {
        description: tCommon('ai.errors.openFileDescription'),
      });
    }
  }, [c, tCommon, fileViewerDisplayMode]);

  return (
    <InlineCitation>
      <InlineCitationCard>
        <InlineCitationCardTrigger sources={[getCitationTriggerLabel(c, tCommon('ai.citations.defaultSource'))]} className='cursor-pointer' onClick={handleClick} />
        <InlineCitationCardBody>
          <InlineCitationCarousel>
            <InlineCitationCarouselContent>
              <InlineCitationCarouselItem>
                <InlineCitationSource title={c.source || tCommon('ai.citations.defaultSource')} description={c.page ? tCommon('ai.citations.page', { page: c.page }) : undefined} />
                {c.pageContent && <InlineCitationQuote>{c.pageContent}</InlineCitationQuote>}
              </InlineCitationCarouselItem>
            </InlineCitationCarouselContent>
          </InlineCitationCarousel>
        </InlineCitationCardBody>
      </InlineCitationCard>
    </InlineCitation>
  );
};

// Citations Inline - renders citation badges after text content
const CitationsInline = ({ citations }: { citations: CitationData[] }) => {
  const { t: tCommon } = useModuleTranslation('common');
  const fileViewerDisplayMode = useFileViewerDisplayMode();

  const handleCitationClick = async (c: CitationData) => {
    try {
      await openCitationSource(c, fileViewerDisplayMode, tCommon('ai.citations.defaultSource'));
    } catch (error) {
      console.error('Failed to open citation source:', error);
      toast.error(tCommon('ai.errors.openFileTitle'), {
        description: tCommon('ai.errors.openFileDescription'),
      });
    }
  };

  return (
    <span className='inline-flex flex-wrap gap-1 ml-1'>
      {citations.map((c, i) => (
        <InlineCitation key={i}>
          <InlineCitationCard>
            <InlineCitationCardTrigger sources={[getCitationTriggerLabel(c, tCommon('ai.citations.defaultSource'))]} className='cursor-pointer' onClick={() => handleCitationClick(c)} />
            <InlineCitationCardBody>
              <InlineCitationCarousel>
                <InlineCitationCarouselContent>
                  <InlineCitationCarouselItem>
                    <InlineCitationSource title={c.source || tCommon('ai.citations.defaultSource')} description={c.page ? tCommon('ai.citations.page', { page: c.page }) : undefined} />
                    {c.pageContent && <InlineCitationQuote>{c.pageContent}</InlineCitationQuote>}
                  </InlineCitationCarouselItem>
                </InlineCitationCarouselContent>
              </InlineCitationCarousel>
            </InlineCitationCardBody>
          </InlineCitationCard>
        </InlineCitation>
      ))}
    </span>
  );
};

// Citation Part - standalone citation (no parent text)
const CitationPartRenderer = ({ citation }: { citation: CitationPart }) => (
  <CitationsInline
    citations={[
      {
        parentId: citation.parentId,
        sourceType: citation.sourceType,
        source: citation.source,
        externalId: citation.externalId,
        page: citation.page,
        pageContent: citation.pageContent,
        workspaceId: citation.workspaceId,
        reference: citation.reference,
        path: citation.path,
        height: citation.height,
        width: citation.width,
        highlightText: citation.highlightText,
        highlightBBox: citation.highlightBBox,
        blockBBox: citation.blockBBox,
      },
    ]}
  />
);

// Code Part
const CodePartRenderer = ({ content, language, filename }: { content: string; language: string; filename?: string }) => <CodeArtifact code={content} language={language as BundledLanguage} filename={filename} className='my-2' />;

// Reasoning Part
const ReasoningPartRenderer = ({ content, duration, isStreaming = false }: { content: string; duration?: number; isStreaming?: boolean }) => (
  <Reasoning duration={duration} isStreaming={isStreaming} defaultOpen={isStreaming}>
    <ReasoningTrigger />
    <ReasoningContent>{content}</ReasoningContent>
  </Reasoning>
);

// Queue Part
const QueuePartRenderer = ({ title, items, isStreaming = false }: { title?: string; items: QueueItemData[]; isStreaming?: boolean }) => {
  const { t: tCommon } = useModuleTranslation('common');
  const pendingItems = items.filter((i) => i.status !== 'completed');
  const completedItems = items.filter((i) => i.status === 'completed');
  const pendingLabel = title || tCommon('ai.queue.pendingLabel');
  const completedLabel = tCommon('ai.queue.completedLabel');

  return (
    <Queue className='my-2'>
      {pendingItems.length > 0 && (
        <QueueSection defaultOpen={isStreaming}>
          <QueueSectionTrigger>
            <QueueSectionLabel count={pendingItems.length} label={pendingLabel} icon={<ListTodo className='h-4 w-4' />} />
          </QueueSectionTrigger>
          <QueueSectionContent>
            <QueueList>
              {pendingItems.map((item) => (
                <QueueItem key={item.id}>
                  <div className='flex items-center gap-2'>
                    <QueueItemIndicator completed={false} />
                    <QueueItemContent completed={false}>{item.title}</QueueItemContent>
                  </div>
                </QueueItem>
              ))}
            </QueueList>
          </QueueSectionContent>
        </QueueSection>
      )}
      {completedItems.length > 0 && (
        <QueueSection defaultOpen={false}>
          <QueueSectionTrigger>
            <QueueSectionLabel count={completedItems.length} label={completedLabel} icon={<CheckCircle2 className='h-4 w-4 text-green-500' />} />
          </QueueSectionTrigger>
          <QueueSectionContent>
            <QueueList>
              {completedItems.map((item) => (
                <QueueItem key={item.id}>
                  <div className='flex items-center gap-2'>
                    <QueueItemIndicator completed={true} />
                    <QueueItemContent completed={true}>{item.title}</QueueItemContent>
                  </div>
                </QueueItem>
              ))}
            </QueueList>
          </QueueSectionContent>
        </QueueSection>
      )}
    </Queue>
  );
};

// Plan Part
function PlanStepIcon({ status }: { status: TaskStatus }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className='h-4 w-4 mt-0.5 text-green-500 shrink-0' />;
    case 'in_progress':
      return <Loader2 className='h-4 w-4 mt-0.5 text-blue-500 shrink-0 animate-spin' />;
    case 'error':
      return <XCircle className='h-4 w-4 mt-0.5 text-destructive shrink-0' />;
    default:
      return <Circle className='h-4 w-4 mt-0.5 text-muted-foreground/50 shrink-0' />;
  }
}

const PlanPartRenderer = ({ title, description, steps, status = 'pending', isStreaming = false }: { title: string; description: string; steps?: PlanStepData[]; status?: TaskStatus; isStreaming?: boolean }) => {
  const { t: tCommon } = useModuleTranslation('common');
  return (
    <Plan className='my-2' isStreaming={isStreaming}>
      <PlanHeader className='flex flex-col w-full'>
        <div className='flex flex-col min-w-0 gap-2 w-full'>
          <div className='flex items-start justify-between gap-2 w-full'>
            <PlanTitle className='flex-1 min-w-0'>{title}</PlanTitle>
            {status === 'completed' && !isStreaming && (
              <Button size='sm' variant='outline' className='shrink-0 gap-1'>
                <PlayIcon className='h-3 w-3' />
                {tCommon('ai.plan.replay')}
              </Button>
            )}
          </div>
          <PlanDescription className='w-full'>{description}</PlanDescription>
        </div>
      </PlanHeader>
      {steps && steps.length > 0 && (
        <PlanContent>
          <ul className='space-y-1.5 text-sm text-muted-foreground'>
            {steps.map((step, index) => (
              <li key={index} className='flex items-start gap-2'>
                <PlanStepIcon status={step.status} />
                <div className='flex flex-col gap-0.5'>
                  <span>{step.task}</span>
                  {step.agent && (
                    <span className='flex items-center gap-1 text-[11px] text-muted-foreground/60'>
                      <Bot className='h-3 w-3' />
                      {step.agent}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </PlanContent>
      )}
    </Plan>
  );
};

/** Turns "hello_world-foo" into "Hello World Foo" */
const formatLabel = (raw: string): string => {
  if (!raw) return '';
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

// Checkpoint Part
const CheckpointPartRenderer = ({ label }: { label: string }) => (
  <Checkpoint className='my-4'>
    <CheckpointIcon />
    <CheckpointTrigger className='text-md whitespace-nowrap'>{formatLabel(label)}</CheckpointTrigger>
  </Checkpoint>
);

// Tool Info Part - reports a single tool execution and its status via the
// ai-elements Tool component. Our proto only carries title + status, so we map
// the status onto the Tool component's UI states and render the header only.
const TOOL_INFO_STATE_MAP = {
  running: 'input-available',
  completed: 'output-available',
  failed: 'output-error',
} satisfies Record<'running' | 'completed' | 'failed', ToolUIPart['state']>;

/** Parses the tool-call params JSON string; returns undefined when there's nothing to show. */
function parseToolParams(params: string | undefined): unknown {
  if (!params || typeof params !== 'string') return undefined;
  const trimmed = params.trim();
  if (!trimmed || trimmed === '{}' || trimmed === '[]') return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Not valid JSON — surface the raw string rather than dropping it.
    return trimmed;
  }
}

const ToolInfoPartRenderer = ({ title, status, params }: { title: string; status: 'running' | 'completed' | 'failed'; params?: string }) => {
  const parsedParams = useMemo(() => parseToolParams(params), [params]);
  const hasParams = parsedParams !== undefined;

  return (
    <Tool className='my-2'>
      {/* No params → nothing to expand: drop the chevron and the toggle affordance. */}
      <ToolHeader type={`tool-${title}`} title={formatLabel(title)} state={TOOL_INFO_STATE_MAP[status]} className={cn(!hasParams && 'cursor-default [&>svg]:hidden')} />
      {hasParams && (
        <ToolContent>
          <ToolInput className='space-y-1 p-2 [&_pre]:p-2! [&_pre]:text-xs! [&_code]:text-xs!' input={parsedParams} />
        </ToolContent>
      )}
    </Tool>
  );
};

// Chain of Thought Part - collapsed list of reasoning step titles, pinned to the
// top of the response. Closed by default; the user toggles it open/closed.
const ChainOfThoughtPartRenderer = ({ steps }: { steps: string[] }) => {
  const { t: tCommon } = useModuleTranslation('common');
  if (!steps.length) return null;

  return (
    <ChainOfThought className='my-2' defaultOpen={false}>
      <ChainOfThoughtHeader>{tCommon('ai.chainOfThought.label')}</ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {steps.map((step, index) => (
          <ChainOfThoughtStep key={index} label={step} />
        ))}
      </ChainOfThoughtContent>
    </ChainOfThought>
  );
};

// Task Part
const TaskPartRenderer = ({ title, items, status, isStreaming = false, activity, showDiagnostics = true }: { title: string; items: string[]; status?: 'pending' | 'in_progress' | 'completed'; isStreaming?: boolean; activity?: TaskActivityStep[]; showDiagnostics?: boolean }) => {
  const { t: tCommon } = useModuleTranslation('common');
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const activityMode = activity !== undefined;
  const diagnostics = items.map(redactDiagnosticText).filter(Boolean);

  const statusIcon = (stepStatus: TaskActivityStep['status'], index: number) => {
    const resolvedStatus = stepStatus ?? (status === 'completed' ? 'completed' : isStreaming && index === (activity?.length ?? 0) - 1 ? 'running' : 'completed');
    if (resolvedStatus === 'failed') return <XCircle className='size-4 shrink-0 text-destructive' />;
    if (resolvedStatus === 'running') return <Loader2 className='size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none' />;
    return <CheckCircle2 className='size-4 shrink-0 text-primary' />;
  };

  return (
    <>
      <Task className='my-2' defaultOpen={isStreaming}>
        <div className='flex items-center gap-1'>
          <TaskTrigger className='min-w-0 flex-1' title={formatLabel(title)} active={isStreaming && status === 'in_progress'} />
          {activityMode && showDiagnostics && <TaskDiagnosticsTrigger aria-label={tCommon('ai.task.diagnostics.open')} title={tCommon('ai.task.diagnostics.open')} onClick={() => setDiagnosticsOpen(true)} />}
        </div>
        <TaskContent>
          {activityMode ? (
            activity.length > 0 ? activity.map((step, index) => (
              <TaskItem key={`${step.label}-${index}`} className='flex items-center gap-2'>
                {statusIcon(step.status, index)}
                <span>{step.label}</span>
              </TaskItem>
            )) : (
              <TaskItem>{tCommon(isStreaming ? 'ai.task.activity.running' : 'ai.task.activity.completed')}</TaskItem>
            )
          ) : items.map((item, index) => (
            <TaskItem key={index}>{item}</TaskItem>
          ))}
        </TaskContent>
      </Task>

      {activityMode && showDiagnostics && (
        <Dialog open={diagnosticsOpen} onOpenChange={setDiagnosticsOpen}>
          <DialogContent className='max-h-[80vh] max-w-3xl overflow-hidden'>
            <DialogHeader>
              <DialogTitle>{tCommon('ai.task.diagnostics.title')}</DialogTitle>
              <DialogDescription>{tCommon('ai.task.diagnostics.description')}</DialogDescription>
            </DialogHeader>
            <div className='min-h-0 space-y-4 overflow-y-auto'>
              <section className='space-y-2'>
                <h3 className='text-sm font-medium'>{tCommon('ai.task.diagnostics.activity')}</h3>
                {activity.length > 0 ? (
                  <ol className='space-y-1.5 text-sm text-muted-foreground'>
                    {activity.map((step, index) => <li key={`${step.label}-diagnostic-${index}`}>{index + 1}. {step.label}</li>)}
                  </ol>
                ) : <p className='text-sm text-muted-foreground'>{tCommon('ai.task.diagnostics.emptyActivity')}</p>}
              </section>
              <section className='space-y-2'>
                <h3 className='text-sm font-medium'>{tCommon('ai.task.diagnostics.input')}</h3>
                <p className='text-xs text-muted-foreground'>{tCommon('ai.task.diagnostics.redactedNotice')}</p>
                {diagnostics.length > 0 ? diagnostics.map((item, index) => (
                  <pre key={index} className='max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed'>{item}</pre>
                )) : <p className='text-sm text-muted-foreground'>{tCommon('ai.task.diagnostics.emptyInput')}</p>}
              </section>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};

// Error Part
const ErrorPartRenderer = ({ title, content }: { title: string; content: string }) => {
  const { t: tCommon } = useModuleTranslation('common');
  const resolvedTitle = title.startsWith('ai.') ? tCommon(title as any) : title;
  const resolvedContent = content.startsWith('ai.') ? tCommon(content as any) : content;

  return (
    <div className='my-2 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4'>
      <div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-destructive/10'>
        <AlertTriangle className='h-4 w-4 text-destructive' />
      </div>
      <div className='flex min-w-0 flex-col gap-1'>
        {resolvedTitle && <p className='text-sm font-medium text-destructive'>{resolvedTitle}</p>}
        {resolvedContent && <p className='text-sm text-muted-foreground'>{resolvedContent}</p>}
      </div>
    </div>
  );
};

// Sources Part
const SourcesPartRenderer = ({ sources }: { sources: SourceItemData[] }) => (
  <Sources className='my-2'>
    <SourcesTrigger count={sources.length} />
    <SourcesContent>
      {sources.map((source, index) => (
        <Source key={index} href={source.url} title={source.title} />
      ))}
    </SourcesContent>
  </Sources>
);

// Chart Part
const ChartPartRenderer = ({ title, kind, data, config, xAxisKey, yAxisKey, nameKey, zAxisKey, stacked = false, layout = 'horizontal', innerRadius = 0, showLegend = true, showGrid = true, series }: ChartPart) => {
  const { t: tCommon } = useModuleTranslation('common');
  const hasData = Array.isArray(data) && data.length > 0;

  console.log('[ChartPartRenderer] Props:', {
    title,
    kind,
    kindType: typeof kind,
    hasData,
    dataLength: data?.length,
    xAxisKey,
    yAxisKey,
    config,
    series,
  });

  if (!hasData) {
    return <div className='my-4 rounded-xl border bg-card p-4 text-sm text-muted-foreground'>{tCommon('ai.chart.noData')}</div>;
  }

  const showPieLegend = showLegend && kind === 'pie';

  const chartContent = (() => {
    switch (kind) {
      case 'line':
        return (
          <LineChart accessibilityLayer data={data}>
            {showGrid && <CartesianGrid vertical={false} />}
            <XAxis dataKey={xAxisKey} tickLine={false} tickMargin={10} />
            <YAxis dataKey={yAxisKey} />
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            {showLegend && <ChartLegend content={<ChartLegendContent />} />}
            {series.map((s) => (
              <Line key={s.dataKey} type='monotone' dataKey={s.dataKey} stroke={`var(--color-${s.dataKey})`} dot={false} />
            ))}
          </LineChart>
        );
      case 'bar':
        return (
          <BarChart accessibilityLayer data={data} layout={layout}>
            {showGrid && <CartesianGrid vertical={layout !== 'vertical'} horizontal={layout === 'vertical'} />}
            {layout === 'vertical' ? <XAxis type='number' tickLine={false} axisLine={false} /> : <XAxis dataKey={xAxisKey} tickLine={false} tickMargin={10} />}
            {layout === 'vertical' ? <YAxis type='category' dataKey={xAxisKey} tickLine={false} axisLine={false} width={90} /> : <YAxis dataKey={yAxisKey} />}
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            {showLegend && <ChartLegend content={<ChartLegendContent />} />}
            {series.map((s) => (
              <Bar key={s.dataKey} dataKey={s.dataKey} fill={`var(--color-${s.dataKey})`} radius={4} minPointSize={2} stackId={stacked ? 'stack' : undefined} />
            ))}
          </BarChart>
        );
      case 'area':
        return (
          <AreaChart accessibilityLayer data={data}>
            {showGrid && <CartesianGrid vertical={false} />}
            <XAxis dataKey={xAxisKey} tickLine={false} tickMargin={10} />
            <YAxis dataKey={yAxisKey} />
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            {showLegend && <ChartLegend content={<ChartLegendContent />} />}
            {series.map((s) => (
              <Area key={s.dataKey} type='monotone' dataKey={s.dataKey} fill={`var(--color-${s.dataKey})`} stroke={`var(--color-${s.dataKey})`} stackId={stacked ? 'stack' : undefined} />
            ))}
          </AreaChart>
        );
      case 'pie':
        return (
          <PieChart accessibilityLayer>
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            {showPieLegend && <ChartLegend content={<ChartLegendContent />} />}
            <Pie data={data} dataKey={series[0]?.dataKey || yAxisKey || 'value'} nameKey={nameKey || xAxisKey} innerRadius={innerRadius} outerRadius={90}>
              {data.map((entry, index) => {
                const colorIndex = (index % 5) + 1;
                const fill = (entry as any).fill || `var(--chart-${colorIndex})`;
                return <Cell key={`slice-${index}`} fill={fill} />;
              })}
              {innerRadius > 0 && <Label position='center'>{title || tCommon('ai.chart.donutLabel')}</Label>}
            </Pie>
          </PieChart>
        );
      case 'scatter':
        return (
          <ScatterChart accessibilityLayer>
            {showGrid && <CartesianGrid />}
            <XAxis type='number' dataKey={xAxisKey} name={xAxisKey} />
            <YAxis type='number' dataKey={yAxisKey || series[0]?.dataKey} name={yAxisKey || series[0]?.dataKey} />
            {zAxisKey && <ZAxis type='number' dataKey={zAxisKey} range={[60, 200]} />}
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            {showLegend && <ChartLegend content={<ChartLegendContent />} />}
            <Scatter name={title || tCommon('ai.chart.scatterSeries')} data={data} fill={`var(--color-${series[0]?.dataKey || 'chart'})`} />
          </ScatterChart>
        );
      case 'composed':
        return (
          <ComposedChart accessibilityLayer data={data}>
            {showGrid && <CartesianGrid vertical={false} />}
            <XAxis dataKey={xAxisKey} tickLine={false} tickMargin={10} />
            <YAxis dataKey={yAxisKey} />
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            {showLegend && <ChartLegend content={<ChartLegendContent />} />}
            {series.map((s) => {
              const resolvedKind = s.kind || 'bar';
              if (resolvedKind === 'line') {
                return <Line key={s.dataKey} type='monotone' dataKey={s.dataKey} stroke={`var(--color-${s.dataKey})`} dot={false} />;
              }
              if (resolvedKind === 'area') {
                return <Area key={s.dataKey} type='monotone' dataKey={s.dataKey} fill={`var(--color-${s.dataKey})`} stroke={`var(--color-${s.dataKey})`} />;
              }
              return <Bar key={s.dataKey} dataKey={s.dataKey} fill={`var(--color-${s.dataKey})`} radius={4} minPointSize={2} />;
            })}
          </ComposedChart>
        );
      default:
        return <div className='flex items-center justify-center h-full text-destructive text-sm'>Unknown chart kind: {kind}</div>;
    }
  })();

  return (
    <div className='my-4 rounded-xl border bg-card text-card-foreground shadow w-full' role='figure' aria-label={title || tCommon('ai.chart.a11yLabel')}>
      {title && (
        <div className='p-4 border-b'>
          <h3 className='font-semibold leading-none tracking-tight'>{title}</h3>
        </div>
      )}
      <div className='p-4'>
        <ChartContainer config={config} className='aspect-auto h-[250px] w-full min-w-0'>
          <ResponsiveContainer width='100%' height='100%'>
            {chartContent}
          </ResponsiveContainer>
        </ChartContainer>
      </div>
    </div>
  );
};

// Sandbox Part - Python code execution
const SandboxPartRenderer = ({ code, output, error, outputAvailable }: { code: string; output: string; error: string; outputAvailable: boolean }) => {
  const { t: tCommon } = useModuleTranslation('common');
  // Map our data to SandboxState
  const state: SandboxState = !outputAvailable ? 'call' : error ? 'error' : 'result';

  const hasError = !!error;
  const hasOutput = !!output || !!error;

  return (
    <Sandbox className='my-2'>
      <SandboxHeader title='Python' state={state} />
      <SandboxContent>
        <SandboxTabs defaultValue='code'>
          <SandboxTabsBar className='justify-between'>
            <SandboxTabsList>
              <SandboxTabsTrigger value='code'>{tCommon('ai.sandbox.tab.code')}</SandboxTabsTrigger>
              {outputAvailable && hasOutput && (
                <SandboxTabsTrigger value='output' className={hasError ? 'text-destructive data-[state=active]:text-destructive' : ''}>
                  {hasError ? tCommon('ai.sandbox.tab.error') : tCommon('ai.sandbox.tab.output')}
                </SandboxTabsTrigger>
              )}
            </SandboxTabsList>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-8 w-8 p-0 mr-2'
                    onClick={() =>
                      downloadCode({
                        content: code,
                        language: 'python',
                        defaultName: 'sandbox',
                      })
                    }>
                    <Download className='h-4 w-4' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{tCommon('actionDownload')}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </SandboxTabsBar>
          <SandboxTabContent value='code' className='p-3 bg-muted/30'>
            <pre className='text-sm overflow-x-auto'>
              <code>{code}</code>
            </pre>
          </SandboxTabContent>
          {outputAvailable && hasOutput && (
            <SandboxTabContent value='output' className={cn('p-3', hasError ? 'bg-destructive/5' : '')}>
              <pre className={cn('text-sm overflow-x-auto whitespace-pre-wrap', hasError && 'text-destructive')}>{hasError ? error : output}</pre>
            </SandboxTabContent>
          )}
        </SandboxTabs>
      </SandboxContent>
    </Sandbox>
  );
};

// WebPreview Part - HTML/CSS/JS preview
const WebPreviewPartRenderer = ({ content }: { content: string }) => {
  const { t: tCommon } = useModuleTranslation('common');
  // Auto-open during streaming or for the last AI message
  const shouldAutoOpen = useShouldAutoOpenPreview();
  const [isOpen, setIsOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Track the blob URL in a ref to ensure proper cleanup
  const blobUrlRef = useRef<string | null>(null);

  const blobUrl = useMemo(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    if (!isOpen || !content) return null;

    const hasOwnScheme = /color-scheme/i.test(content);
    const themedHtml = hasOwnScheme
      ? content
      : content.replace(
          /<head([^>]*)>/i,
          '<head$1><meta name="color-scheme" content="light"><style>html,body{background:#fff;color:#111}</style>',
        );
    const previewHtml = isolateGeneratedPreviewHtml(themedHtml);

    const blob = new Blob([previewHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    blobUrlRef.current = url;
    return url;
  }, [content, isOpen]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  // Sync fullscreen state when user exits via Escape key
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen();
    }
  };

  if (!isOpen) {
    // Placeholder when closed
    return (
      <div className='my-2 flex h-[300px] items-center justify-center rounded-lg border bg-muted/30'>
        <Button variant='outline' size='lg' className='gap-2' onClick={() => setIsOpen(true)}>
          <Eye className='h-5 w-5' />
          {tCommon('ai.preview.open')}
        </Button>
      </div>
    );
  }

  // Full preview when open
  return (
    <WebPreview ref={containerRef} className={cn('my-2', isFullscreen ? 'h-screen' : 'h-[600px]')} defaultUrl={blobUrl || ''}>
      <WebPreviewNavigation>
        <span className='flex-1 truncate px-2 text-sm text-muted-foreground'>{tCommon('ai.preview.title')}</span>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={tCommon('ai.preview.downloadHtml')}
                variant='ghost'
                size='sm'
                className='h-8 w-8 p-0'
                onClick={() =>
                  downloadCode({
                    content,
                    language: 'html',
                    defaultName: 'preview',
                  })
                }>
                <Download className='h-4 w-4' />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{tCommon('ai.preview.downloadHtml')}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={isFullscreen ? tCommon('ai.preview.exitFullscreen') : tCommon('ai.preview.fullscreen')}
                variant='ghost'
                size='sm'
                className='h-8 w-8 p-0'
                onClick={toggleFullscreen}>
                {isFullscreen ? <Minimize className='h-4 w-4' /> : <Maximize className='h-4 w-4' />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isFullscreen ? tCommon('ai.preview.exitFullscreen') : tCommon('ai.preview.fullscreen')}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Button variant='ghost' size='sm' className='h-8 px-2' onClick={() => setIsOpen(false)}>
          {tCommon('actionClose')}
        </Button>
      </WebPreviewNavigation>
      <WebPreviewBody isolation='generated' />
    </WebPreview>
  );
};

// Artifact Part - Document/file artifact
const ArtifactPartRenderer = ({ filePath, filename }: { filePath: string; filename: string }) => {
  const { t: tCommon } = useModuleTranslation('common');
  const fileViewerDisplayMode = useFileViewerDisplayMode();
  const [isDownloading, setIsDownloading] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const downloadErrorTitle = tCommon('ai.errors.downloadFailedTitle');
  const downloadErrorDescription = tCommon('ai.errors.downloadFailedDescription');
  const openErrorTitle = tCommon('ai.errors.openFileTitle');
  const openErrorDescription = tCommon('ai.errors.openFileDescription');
  const defaultFileName = tCommon('ai.artifact.defaultName');
  const generatedLabel = tCommon('ai.artifact.generatedFile');
  const downloadTooltipLabel = tCommon('ai.artifact.downloadTooltip', { name: filename || tCommon('ai.artifact.genericFile') });

  const handleDownload = async () => {
    if (isDownloading || !filePath) return;

    setIsDownloading(true);
    try {
      const { getArtifactDownloadUrl } = await import('@/modules/conversation/api');
      const { downloadUrl } = await getArtifactDownloadUrl(filePath, filename);

      window.open(downloadUrl, '_blank');
    } catch (error: unknown) {
      console.error('Failed to download artifact:', error);

      let errorMessage = downloadErrorDescription;
      if (error && typeof error === 'object' && 'message' in error) {
        errorMessage = (error as { message: string }).message;
      }

      toast.error(downloadErrorTitle, {
        description: errorMessage,
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleOpenViewer = async () => {
    if (isOpening || !filePath) return;

    setIsOpening(true);
    try {
      const [{ getArtifactDownloadUrl }, { openFileViewerFromUrl, getMimeTypeFromFilename }] = await Promise.all([import('@/modules/conversation/api'), import('@/modules/file-viewer')]);

      const { downloadUrl } = await getArtifactDownloadUrl(filePath, filename);
      const mimeType = getMimeTypeFromFilename(filename) ?? 'application/octet-stream';
      openFileViewerFromUrl(downloadUrl, filename, mimeType, {
        displayMode: fileViewerDisplayMode,
        closeOnOutsideClick: fileViewerDisplayMode === 'floating',
      });
    } catch (error: unknown) {
      console.error('Failed to open artifact:', error);

      let errorMessage = openErrorDescription;
      if (error && typeof error === 'object' && 'message' in error) {
        errorMessage = (error as { message: string }).message;
      }

      toast.error(openErrorTitle, {
        description: errorMessage,
      });
    } finally {
      setIsOpening(false);
    }
  };

  // Check if this file type can be previewed
  const canView = useMemo(() => isViewableFilename(filename), [filename]);

  return (
    <div className='my-2 flex items-center gap-3 rounded-lg border bg-muted/30 p-3'>
      <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10'>
        <FileText className='h-5 w-5 text-primary' />
      </div>
      <div className='flex flex-1 flex-col min-w-0'>
        <span className='text-sm font-medium truncate'>{filename || defaultFileName}</span>
        <span className='text-xs text-muted-foreground'>{generatedLabel}</span>
      </div>
      <div className='flex items-center gap-1.5'>
        {canView && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant='outline' size='sm' className='h-8 gap-1.5' onClick={handleOpenViewer} disabled={isOpening || !filePath}>
                  {isOpening ? <Loader2 className='h-4 w-4 animate-spin' /> : <Eye className='h-4 w-4' />}
                  {tCommon('actionView')}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{tCommon('ai.artifact.openInViewer')}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant='outline' size='sm' className='h-8 gap-1.5' onClick={handleDownload} disabled={isDownloading || !filePath}>
                {isDownloading ? <Loader2 className='h-4 w-4 animate-spin' /> : <Download className='h-4 w-4' />}
                {tCommon('actionDownload')}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{downloadTooltipLabel}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
};
