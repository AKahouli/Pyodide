import { AlertCircle, Brain, Check, Circle, Loader2, Wrench } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Streamdown } from 'streamdown';
import { cn } from '@/lib/utils';
import type { MessageComponent } from '@/modules/conversation/types';

type ActivityItem = {
  key: string;
  kind: 'reasoning' | 'tool' | 'progress';
  label: string;
  status: 'running' | 'completed' | 'failed' | 'pending';
};

export type AssistantActivityLabels = {
  title: string;
  reasoning: string;
  status: Record<ActivityItem['status'], string>;
};

const SENSITIVE_SUMMARY = /(?:token|secret|password|authorization|cookie|api[ _-]?key)\s*[:=]/i;

function safeSummary(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const summary = value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!summary || summary.length > 180 || /<[^>]+>/.test(summary) || SENSITIVE_SUMMARY.test(summary)) return undefined;
  return summary;
}

function normalizeStatus(value: unknown): ActivityItem['status'] {
  if (value === 'completed') return 'completed';
  if (value === 'failed' || value === 'error') return 'failed';
  if (value === 'running' || value === 'active' || value === 'in_progress') return 'running';
  return 'pending';
}

function getActivityItems(components: readonly MessageComponent[]): ActivityItem[] {
  const items: ActivityItem[] = [];
  let hasReasoning = false;

  components.forEach((component, componentIndex) => {
    if (component.type === 'agentActivity') {
      if (!hasReasoning) {
        items.push({ key: 'reasoning', kind: 'reasoning', label: '', status: 'running' });
        hasReasoning = true;
      }
      return;
    }

    if (component.type === 'toolActivity') {
      const label = safeSummary(component.data.summary) || safeSummary(component.data.fallbackDisplayName) || safeSummary(component.data.toolName);
      if (label) items.push({ key: component.id || `tool-${componentIndex}`, kind: 'tool', label, status: normalizeStatus(component.data.status) });
      return;
    }

    if (component.type === 'checkpoint') {
      const label = safeSummary(component.data.label);
      if (label) items.push({ key: component.id || `checkpoint-${componentIndex}`, kind: 'progress', label, status: 'completed' });
      return;
    }

    if (component.type === 'plan') {
      const label = safeSummary(component.data.title);
      if (label) items.push({ key: component.id || `plan-${componentIndex}`, kind: 'progress', label, status: normalizeStatus(component.data.status) });
      const steps = Array.isArray(component.data.steps) ? component.data.steps : [];
      steps.forEach((step, stepIndex) => {
        if (!step || typeof step !== 'object') return;
        const data = step as Record<string, unknown>;
        const stepLabel = safeSummary(data.task);
        if (stepLabel) items.push({ key: `plan-${componentIndex}-${stepIndex}`, kind: 'progress', label: stepLabel, status: normalizeStatus(data.status) });
      });
      return;
    }

    if (component.type === 'task') {
      const label = safeSummary(component.data.title);
      if (label) items.push({ key: component.id || `task-${componentIndex}`, kind: 'progress', label, status: normalizeStatus(component.data.status) });
      return;
    }

    if (component.type === 'queue') {
      const queueItems = Array.isArray(component.data.items) ? component.data.items : [];
      queueItems.forEach((queueItem, itemIndex) => {
        if (!queueItem || typeof queueItem !== 'object') return;
        const data = queueItem as Record<string, unknown>;
        const label = safeSummary(data.title);
        if (label) items.push({ key: `queue-${componentIndex}-${itemIndex}`, kind: 'progress', label, status: normalizeStatus(data.status) });
      });
    }
  });

  const seen = new Set<string>();
  return items.filter((item) => {
    const identity = `${item.kind}:${item.label.toLocaleLowerCase()}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function AssistantActivity({ components, isStreaming, labels }: Readonly<{ components: readonly MessageComponent[]; isStreaming: boolean; labels: AssistantActivityLabels }>) {
  const items = getActivityItems(components);
  if (!isStreaming && items.length === 0) return null;

  const visibleItems = items.length > 0
    ? items
    : [{ key: 'reasoning-live', kind: 'reasoning' as const, label: '', status: 'running' as const }];

  return (
    <section className='mb-3 rounded-xl border bg-muted/25 px-3 py-3' aria-label={labels.title}>
      <p className='mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>{labels.title}</p>
      <div className='space-y-2 border-l border-border pl-3'>
        {visibleItems.map((item) => {
          const status = !isStreaming && item.status === 'running' ? 'completed' : item.status;
          const Icon = status === 'running' ? Loader2 : status === 'completed' ? Check : status === 'failed' ? AlertCircle : Circle;
          const KindIcon = item.kind === 'tool' ? Wrench : Brain;
          return (
            <div key={item.key} className='flex min-w-0 items-center gap-2 text-xs'>
              <Icon className={cn('-ml-[1.05rem] size-3.5 shrink-0 bg-background', status === 'running' ? 'animate-spin text-primary' : status === 'failed' ? 'text-destructive' : 'text-muted-foreground')} aria-hidden='true' />
              <KindIcon className='size-3.5 shrink-0 text-muted-foreground' aria-hidden='true' />
              <span className='min-w-0 flex-1 break-words text-foreground'>{item.label || labels.reasoning}</span>
              <span className='shrink-0 text-[10px] text-muted-foreground'>{labels.status[status]}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function AssistantMarkdown({ className, ...props }: ComponentProps<typeof Streamdown>) {
  return (
    <Streamdown
      className={cn('min-w-0 w-full max-w-full overflow-hidden break-words [&_code]:[overflow-wrap:anywhere] [&_ol]:my-2 [&_ol]:pl-5 [&_p]:my-2 [&_p]:[overflow-wrap:anywhere] [&_pre]:w-full [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre_code]:break-normal [&_pre_code]:[overflow-wrap:normal] [&_table]:my-3 [&_table]:block [&_table]:w-full [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:whitespace-nowrap [&_ul]:my-2 [&_ul]:pl-5', className)}
      {...props}
    />
  );
}
