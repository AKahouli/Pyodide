import { useEffect, useMemo, useState } from 'react';
import { BrainCircuit, ChevronRight, Code2, FileText, Globe2, Loader2, Search, Wrench } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ArtifactPartRenderer } from '@/components/ai-elements/ai-message-content';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { ArtifactActivityNode, ConversationActivityNode, ToolActivityNode } from '../utils/conversation-turn-projection';
import { humanizeToolTitle, resolveToolRenderKind } from '../utils/tool-activity';

function latestLine(content: string): string {
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.at(-1) || content;
}

function getRunCodeDetails(node: ToolActivityNode): { code?: string; durationMs?: number } {
  let code: string | undefined;
  let durationMs: number | undefined;
  try {
    if (node.params) {
      const params = JSON.parse(node.params) as Record<string, unknown>;
      if (typeof params.code === 'string') code = params.code;
    }
  } catch {
    // Generic params remain available below.
  }
  try {
    if (node.resultJson) {
      const result = JSON.parse(node.resultJson) as Record<string, unknown>;
      const execution = result.execution;
      if (execution && typeof execution === 'object' && typeof (execution as Record<string, unknown>).durationMs === 'number') {
        durationMs = (execution as Record<string, number>).durationMs;
      }
    }
  } catch {
    // Generic output remains available below.
  }
  return { code, durationMs };
}

function ActivityIcon({ node }: Readonly<{ node: ConversationActivityNode }>) {
  if (node.type === 'reasoning') return node.streaming ? <Loader2 className='size-4 animate-spin' /> : <BrainCircuit className='size-4' />;
  const kind = resolveToolRenderKind(node.title);
  if (node.status === 'running') return <Loader2 className='size-4 animate-spin' />;
  if (kind === 'run_code') return <Code2 className='size-4' />;
  if (kind === 'search') return <Search className='size-4' />;
  if (kind === 'web') return <Globe2 className='size-4' />;
  if (kind === 'document' || kind === 'file') return <FileText className='size-4' />;
  return <Wrench className='size-4' />;
}

function ReasoningActivityRow({ node }: Readonly<{ node: Extract<ConversationActivityNode, { type: 'reasoning' }> }>) {
  const { t } = useModuleTranslation('conversation');
  const summary = latestLine(node.content);
  const duration = node.duration === undefined ? '' : t('stream.activity.toolDuration', { seconds: Math.round(node.duration / 1000) });
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <button type='button' className='group flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'>
          <span className='text-primary' aria-hidden='true'><ActivityIcon node={node} /></span>
          <span className='shrink-0 font-medium text-foreground'>{node.streaming ? t('stream.activity.thinking') : t('stream.activity.thought')}</span>
          {duration && <span className='shrink-0'>· {duration}</span>}
          <span className='min-w-0 flex-1 truncate'>· {summary}</span>
          <ChevronRight className='size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90' aria-hidden='true' />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className='ml-8 border-l pl-4 pr-2 pb-3 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground'>
        {node.content}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolActivityRow({ node }: Readonly<{ node: ToolActivityNode }>) {
  const { t } = useModuleTranslation('conversation');
  const kind = resolveToolRenderKind(node.title);
  const title = humanizeToolTitle(node.title) || t('stream.activity.toolFallback');
  const { code, durationMs } = useMemo(() => getRunCodeDetails(node), [node]);
  const status = t(`stream.activity.toolStatus.${node.status}`);
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <button type='button' className='group flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'>
          <span className={cn('text-primary', node.status === 'failed' && 'text-destructive')} aria-hidden='true'><ActivityIcon node={node} /></span>
          <span className='min-w-0 flex-1 truncate font-medium text-foreground'>{title}</span>
          {durationMs !== undefined && <span className='tabular-nums'>{t('stream.activity.durationMs', { duration: (durationMs / 1000).toFixed(1) })}</span>}
          <span className={cn(node.status === 'failed' && 'text-destructive')}>· {status}</span>
          <ChevronRight className='size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90' aria-hidden='true' />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className='ml-8 space-y-3 border-l pl-4 pr-2 pb-3'>
        {kind === 'run_code' && code && (
          <div>
            <p className='mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{t('stream.activity.code')}</p>
            <pre className='max-h-64 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap break-words'>{code}</pre>
          </div>
        )}
        {node.params && (!code || kind !== 'run_code') && (
          <div>
            <p className='mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{t('stream.activity.input')}</p>
            <pre className='max-h-64 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap break-words'>{node.params}</pre>
          </div>
        )}
        {node.resultJson && (
          <div>
            <p className='mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{t('stream.activity.output')}</p>
            <pre className='max-h-64 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap break-words'>{node.resultJson}</pre>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function WorkingStatusRow() {
  const { t } = useModuleTranslation('conversation');
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div role='status' className='flex min-h-10 items-center gap-2 px-2 text-sm text-muted-foreground'>
      <Loader2 className='size-4 animate-spin text-primary' aria-hidden='true' />
      <span>{t('stream.activity.elapsed', { seconds })}</span>
    </div>
  );
}

export function ConversationActivity({ activity, artifacts, showWorking = false }: Readonly<{
  activity: readonly ConversationActivityNode[];
  artifacts: readonly ArtifactActivityNode[];
  showWorking?: boolean;
}>) {
  if (!activity.length && !artifacts.length && !showWorking) return null;
  return (
    <div className='mx-2 mb-2 space-y-1 md:mx-4' data-testid='conversation-activity'>
      {showWorking && !activity.length && <WorkingStatusRow />}
      {activity.map((node) => node.type === 'reasoning'
        ? <ReasoningActivityRow key={node.key} node={node} />
        : <ToolActivityRow key={node.key} node={node} />)}
      {artifacts.map((artifact) => <ArtifactPartRenderer key={artifact.key} filePath={artifact.filePath} filename={artifact.filename} />)}
    </div>
  );
}
