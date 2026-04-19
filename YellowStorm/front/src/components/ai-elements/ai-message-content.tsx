'use client';

import { cn } from '@/lib/utils';
import { downloadCode } from '@/lib/download';
import { toast } from 'sonner';
import { useState, useMemo, useEffect, useRef, type HTMLAttributes } from 'react';
import { useShouldAutoOpenPreview, useFileViewerDisplayMode } from './message-context';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeArtifact } from './code-artifact';
import { Reasoning, ReasoningTrigger, ReasoningContent } from './reasoning';
import { Queue, QueueSection, QueueSectionTrigger, QueueSectionLabel, QueueSectionContent, QueueList, QueueItem, QueueItemIndicator, QueueItemContent } from './queue';
import { Plan, PlanHeader, PlanTitle, PlanDescription, PlanContent, PlanFooter } from './plan';
import { Checkpoint, CheckpointIcon, CheckpointTrigger } from './checkpoint';
import { Task, TaskTrigger, TaskContent, TaskItem } from './task';
import { Sources, SourcesTrigger, SourcesContent, Source } from './sources';
import { Sandbox, SandboxHeader, SandboxContent, SandboxTabs, SandboxTabsBar, SandboxTabsList, SandboxTabsTrigger, SandboxTabContent, type SandboxState } from './sandbox';
import { WebPreview, WebPreviewNavigation, WebPreviewBody } from './web-preview';
import { InlineCitation, InlineCitationCard, InlineCitationCardTrigger, InlineCitationCardBody, InlineCitationCarousel, InlineCitationCarouselContent, InlineCitationCarouselItem, InlineCitationSource, InlineCitationQuote } from './inline-citation';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PlayIcon, CheckCircle2, Circle, ListTodo, AlertTriangle, Loader2, Bot, Eye, Download, FileText, XCircle, Maximize, Minimize } from 'lucide-react';
import type { BundledLanguage } from 'shiki';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Label, Line, LineChart, Pie, PieChart, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from 'recharts';
import { ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { useModuleTranslation } from '@/modules/localization';
import { isViewableFilename } from '@/modules/file-viewer/renderers';
import { Separator } from '../ui/separator';

// ============================================================================
// Message Content Part Types
// ============================================================================

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

export interface ChartPart {
  type: 'chart';
  title?: string;
  kind: 'line' | 'bar' | 'area' | 'pie' | 'scatter' | 'composed';
  data: Record<string, any>[];
  config: ChartConfig;
  xAxisKey: string;
  yAxisKey?: string;
  nameKey?: string;
  zAxisKey?: string;
  stacked?: boolean;
  layout?: 'horizontal' | 'vertical';
  innerRadius?: number;
  showLegend?: boolean;
  showGrid?: boolean;
  series: { dataKey: string; color?: string; label?: string; kind?: 'line' | 'bar' | 'area' | 'pie' | 'scatter' | 'composed' }[];
}

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
}

export type MessageContentPart = TextPart | CodePart | ReasoningPart | QueuePart | PlanPart | CheckpointPart | ChartPart | TaskPart | ErrorPart | SourcesPart | SandboxPart | WebPreviewPart | ArtifactPart | CitationPart;

// ============================================================================
// AIMessageContent Component
// ============================================================================

export type AIMessageContentProps = HTMLAttributes<HTMLDivElement> & {
  parts: MessageContentPart[];
  /** Whether the message is currently streaming. Affects default open state of collapsible components. */
  isStreaming?: boolean;
};

/**
 * AIMessageContent - Renders structured AI message content using ai-sdk components
 */
export const AIMessageContent = ({ parts, className, isStreaming = false, ...props }: AIMessageContentProps) => {
  return (
    <div className={cn('space-y-4', className)} {...props}>
      {parts.map((part, index) => (
        <AIMessagePart key={index} part={part} isStreaming={isStreaming} />
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
};

const AIMessagePart = ({ part, isStreaming = false }: AIMessagePartProps) => {
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
      return <ChartPartRenderer title={part.title} kind={part.kind} data={part.data} config={part.config} xAxisKey={part.xAxisKey} yAxisKey={part.yAxisKey} nameKey={part.nameKey} zAxisKey={part.zAxisKey} stacked={part.stacked} layout={part.layout} innerRadius={part.innerRadius} showLegend={part.showLegend} showGrid={part.showGrid} series={part.series} />;
    case 'task':
      return <TaskPartRenderer title={part.title} items={part.items} status={part.status} isStreaming={isStreaming} />;
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
    default:
      return null;
  }
};

// Text Part with Markdown support
const TextPartRenderer = ({ content, showCursor, citations }: { content: string; showCursor?: boolean; citations?: CitationData[] }) => {
  const hasCitations = citations && citations.length > 0;
  return (
  <div className={cn(
    showCursor && "[&>*:last-child]:after:content-[''] [&>*:last-child]:after:inline-block [&>*:last-child]:after:w-[3px] [&>*:last-child]:after:h-4 [&>*:last-child]:after:bg-foreground [&>*:last-child]:after:ml-0.5 [&>*:last-child]:after:animate-pulse [&>*:last-child]:after:align-text-bottom",
    hasCitations && '[&>*:nth-last-child(2)]:not(:where(ul, ol, pre)):inline [&>*:nth-last-child(2)]:not(:where(ul, ol, pre)):mb-0',
  )}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Inline code
        code({ children, ...props }) {
          return (
            <code className='bg-muted px-1.5 py-0.5 rounded text-sm' {...props}>
              {children}
            </code>
          );
        },
        // Code blocks
        pre({ children }) {
          return <pre className='bg-muted rounded-md p-3 overflow-x-auto my-4 text-sm'>{children}</pre>;
        },
        // Links
        a({ children, ...props }) {
          return (
            <a className='inline-flex items-center gap-1 rounded-full bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors' target='_blank' rel='noopener noreferrer' {...props}>
              {children}
            </a>
          );
        },
        // Paragraphs
        p({ children }) {
          return <p className='mb-3 last:mb-0 leading-loose'>{children}</p>;
        },
        // Lists
        ul({ children }) {
          return <ul className='list-disc pl-5 mb-4 space-y-1'>{children}</ul>;
        },
        ol({ children }) {
          return <ol className='list-decimal pl-5 mb-4 space-y-1'>{children}</ol>;
        },
        li({ children }) {
          return <li className='mb-1.5 leading-loose'>{children}</li>;
        },
        // Headings
        h1({ children }) {
          return <h1 className='text-xl font-bold mb-3 mt-6 first:mt-0'>{children}</h1>;
        },
        h2({ children }) {
          return <h2 className='text-lg font-bold mb-3 mt-5 first:mt-0'>{children}</h2>;
        },
        h3({ children }) {
          return <h3 className='text-base font-bold mb-2 mt-4 first:mt-0'>{children}</h3>;
        },
        // Horizontal rule
        hr() {
          return <hr className='my-8 border-t-2 border-muted-foreground/80' />;
        },
        // Blockquotes
        blockquote({ children }) {
          return <blockquote className='border-l-4 border-muted-foreground/30 pl-4 italic my-4'>{children}</blockquote>;
        },
        // Tables
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
      }}>
      {content}
    </ReactMarkdown>
    {hasCitations && <CitationsInline citations={citations} />}
  </div>
  );
};

// Citations Inline - renders citation badges after text content
const CitationsInline = ({ citations }: { citations: CitationData[] }) => {
  const { t: tCommon } = useModuleTranslation('common');
  const fileViewerDisplayMode = useFileViewerDisplayMode();

  const handleCitationClick = async (c: CitationData) => {
    try {
      const { openFileViewer, getMimeTypeFromFilename } = await import('@/modules/file-viewer');

      const mimeType = getMimeTypeFromFilename(c.source) ?? 'application/octet-stream';

      // Extract page number from page string
      // e.g. "report.pdf - page 5" → 5, or "5" → 5
      const numbers = c.page?.match(/\d+/g);
      const page = numbers?.length ? parseInt(numbers[numbers.length - 1], 10) : undefined;

      await openFileViewer(c.workspaceId, c.externalId, c.source || tCommon('ai.citations.defaultSource'), mimeType, {
        page,
        highlightText: c.pageContent || undefined,
        displayMode: fileViewerDisplayMode,
      });
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
            <InlineCitationCardTrigger sources={[c.reference || c.source || tCommon('ai.citations.defaultSource')]} className='cursor-pointer' onClick={() => handleCitationClick(c)} />
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

// Task Part
const TaskPartRenderer = ({ title, items, status, isStreaming = false }: { title: string; items: string[]; status?: 'pending' | 'in_progress' | 'completed'; isStreaming?: boolean }) => (
  <Task className='my-2 ' defaultOpen={isStreaming}>
    <TaskTrigger title={formatLabel(title)} />
    <TaskContent>
      {items.map((item, index) => (
        <TaskItem key={index}>{item}</TaskItem>
      ))}
    </TaskContent>
  </Task>
);

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
const ChartPartRenderer = ({ title, kind, data, config, xAxisKey, yAxisKey, nameKey, zAxisKey, stacked = false, layout = 'horizontal', innerRadius = 0, showLegend = true, showGrid = true, series }: { title?: string; kind: 'line' | 'bar' | 'area' | 'pie' | 'scatter' | 'composed'; data: Record<string, any>[]; config: ChartConfig; xAxisKey: string; yAxisKey?: string; nameKey?: string; zAxisKey?: string; stacked?: boolean; layout?: 'horizontal' | 'vertical'; innerRadius?: number; showLegend?: boolean; showGrid?: boolean; series: { dataKey: string; color?: string; label?: string; kind?: 'line' | 'bar' | 'area' | 'pie' | 'scatter' | 'composed' }[] }) => {
  const { t: tCommon } = useModuleTranslation('common');
  const hasData = data.length > 0;

  if (!hasData) {
    return (
      <div className='my-4 rounded-xl border bg-card p-4 text-sm text-muted-foreground'>
        {tCommon('ai.chart.noData')}
      </div>
    );
  }

  const showPieLegend = showLegend && kind === 'pie';

  return (
    <div className='my-4 rounded-xl border bg-card text-card-foreground shadow w-full' role='figure' aria-label={title || tCommon('ai.chart.a11yLabel')}>
      {title && (
        <div className='p-4 border-b'>
          <h3 className='font-semibold leading-none tracking-tight'>{title}</h3>
        </div>
      )}
      <div className='p-4'>
        <ChartContainer config={config} className='aspect-auto h-[250px] w-full'>
          <div className='h-full w-full'>
            {kind === 'line' && (
              <LineChart accessibilityLayer data={data}>
                {showGrid && <CartesianGrid vertical={false} />}
                <XAxis dataKey={xAxisKey} tickLine={false} tickMargin={10} axisLine={false} />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                {showLegend && <ChartLegend content={<ChartLegendContent />} />}
                {series.map((s) => <Line key={s.dataKey} type='monotone' dataKey={s.dataKey} stroke={`var(--color-${s.dataKey})`} dot={false} />)}
              </LineChart>
            )}
            {kind === 'bar' && (
              <BarChart accessibilityLayer data={data} layout={layout}>
                {showGrid && <CartesianGrid vertical={layout !== 'vertical'} horizontal={layout === 'vertical'} />}
                {layout === 'vertical' ? <XAxis type='number' tickLine={false} axisLine={false} /> : <XAxis dataKey={xAxisKey} tickLine={false} tickMargin={10} axisLine={false} />}
                {layout === 'vertical' ? <YAxis type='category' dataKey={xAxisKey} tickLine={false} axisLine={false} width={90} /> : <YAxis />}
                <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                {showLegend && <ChartLegend content={<ChartLegendContent />} />}
                {series.map((s) => <Bar key={s.dataKey} dataKey={s.dataKey} fill={`var(--color-${s.dataKey})`} radius={4} stackId={stacked ? 'stack' : undefined} />)}
              </BarChart>
            )}
            {kind === 'area' && (
              <AreaChart accessibilityLayer data={data}>
                {showGrid && <CartesianGrid vertical={false} />}
                <XAxis dataKey={xAxisKey} tickLine={false} tickMargin={10} axisLine={false} />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                {showLegend && <ChartLegend content={<ChartLegendContent />} />}
                {series.map((s) => <Area key={s.dataKey} type='monotone' dataKey={s.dataKey} fill={`var(--color-${s.dataKey})`} stroke={`var(--color-${s.dataKey})`} stackId={stacked ? 'stack' : undefined} />)}
              </AreaChart>
            )}
            {kind === 'pie' && (
              <PieChart accessibilityLayer>
                <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                {showPieLegend && <ChartLegend content={<ChartLegendContent />} />}
                <Pie data={data} dataKey={series[0]?.dataKey || yAxisKey || 'value'} nameKey={nameKey || xAxisKey} innerRadius={innerRadius} outerRadius={90}>
                  {data.map((entry, index) => {
                    const seriesKey = series[index]?.dataKey || series[0]?.dataKey || 'value';
                    const fill = entry.fill || `var(--color-${seriesKey})`;
                    return <Cell key={`${seriesKey}-${index}`} fill={fill} />;
                  })}
                  {innerRadius > 0 && <Label position='center'>{title || tCommon('ai.chart.donutLabel')}</Label>}
                </Pie>
              </PieChart>
            )}
            {kind === 'scatter' && (
              <ScatterChart accessibilityLayer>
                {showGrid && <CartesianGrid />}
                <XAxis type='number' dataKey={xAxisKey} name={xAxisKey} />
                <YAxis type='number' dataKey={yAxisKey || series[0]?.dataKey} name={yAxisKey || series[0]?.dataKey} />
                {zAxisKey && <ZAxis type='number' dataKey={zAxisKey} range={[60, 200]} />}
                <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                {showLegend && <ChartLegend content={<ChartLegendContent />} />}
                <Scatter name={title || tCommon('ai.chart.scatterSeries')} data={data} fill={`var(--color-${series[0]?.dataKey || 'chart'})`} />
              </ScatterChart>
            )}
            {kind === 'composed' && (
              <ComposedChart accessibilityLayer data={data}>
                {showGrid && <CartesianGrid vertical={false} />}
                <XAxis dataKey={xAxisKey} tickLine={false} tickMargin={10} axisLine={false} />
                <YAxis />
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
                  return <Bar key={s.dataKey} dataKey={s.dataKey} fill={`var(--color-${s.dataKey})`} radius={4} />;
                })}
              </ComposedChart>
            )}
          </div>
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
  const [isOpen, setIsOpen] = useState(shouldAutoOpen);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Track the blob URL in a ref to ensure proper cleanup
  const blobUrlRef = useRef<string | null>(null);

  // Generate blob URL only when open and content is available
  // This avoids creating blob URLs that might get cleaned up before use
  const blobUrl = useMemo(() => {
    // Revoke previous blob URL if it exists
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    // Only create blob URL when preview is open and we have content
    if (!isOpen || !content) return null;

    const blob = new Blob([content], { type: 'text/html' });
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
    <WebPreview ref={containerRef} className={cn('my-2', isFullscreen ? 'h-screen' : 'h-[400px]')} defaultUrl={blobUrl || ''}>
      <WebPreviewNavigation>
        <span className='flex-1 truncate px-2 text-sm text-muted-foreground'>{tCommon('ai.preview.title')}</span>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
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
              <Button variant='ghost' size='sm' className='h-8 w-8 p-0' onClick={toggleFullscreen}>
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
      <WebPreviewBody />
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
      openFileViewerFromUrl(downloadUrl, filename, mimeType, { displayMode: fileViewerDisplayMode });
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
