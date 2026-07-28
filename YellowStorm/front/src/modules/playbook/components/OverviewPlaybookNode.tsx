import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Bot, Braces, GitBranch, Hand, ListTree, Loader2, Mail, Play, Repeat2 } from 'lucide-react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAgentStore } from '@/modules/agent/store';
import { useModuleTranslation } from '@/modules/localization';
import { PlaybookStatusBadge } from './PlaybookStatusBadge';
import { getStepNumberTone } from './ExecutionStepList';
import type { OverviewNode, OverviewNodeKind } from '../utils/overview-canvas';

const KIND_ICON: Record<OverviewNodeKind, typeof Bot> = {
  trigger: Mail,
  agent: Bot,
  action: Braces,
  evaluation: ListTree,
  iterator: Repeat2,
  router: GitBranch,
  human_approval: Hand,
};

export function OverviewPlaybookNode({ id, data, selected }: NodeProps<OverviewNode>) {
  const { t } = useModuleTranslation('playbook');
  const getAgentById = useAgentStore((state) => state.getAgentById);
  const agent = data.assignedAgentId ? getAgentById(data.assignedAgentId) : null;
  const Icon = KIND_ICON[data.kind];
  const title = data.title || t('node.untitled');
  const titleRef = useRef<HTMLDivElement | null>(null);
  const [titleTruncated, setTitleTruncated] = useState(false);
  const [titleTooltipOpen, setTitleTooltipOpen] = useState(false);
  const subtitle = data.kind === 'iterator' && data.childCount
    ? t('canvas.overview.childSteps', { count: data.childCount })
    : agent?.name || t(`canvas.overview.type.${data.kind}`);
  const isRunning = data.stepStatus === 'running';
  const playDisabled = data.executionDisabled || !data.isEnabled || !data.isConfigured;

  const measureTitle = useCallback(() => {
    const element = titleRef.current;
    if (!element) return false;
    const truncated = element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth;
    setTitleTruncated(truncated);
    return truncated;
  }, []);

  useLayoutEffect(() => {
    measureTitle();
    const element = titleRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measureTitle);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measureTitle, title]);

  const titleElement = (
    <div
      ref={titleRef}
      className="line-clamp-2 min-w-0 text-xs font-semibold leading-[15px] text-card-foreground"
      onPointerEnter={measureTitle}
    >
      {title}
    </div>
  );

  return (
    <div
      className={cn(
        'relative h-[96px] w-[220px] rounded-xl border bg-card/95 shadow-sm transition-[opacity,border-color,box-shadow] duration-200',
        selected ? 'border-primary ring-2 ring-primary/30 shadow-md' : 'border-border',
        data.dimmed && 'opacity-20',
      )}
      aria-label={t('canvas.overview.nodeLabel', { title, type: t(`canvas.overview.type.${data.kind}`) })}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-muted-foreground" isConnectable={false} />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-muted-foreground" isConnectable={false} />
      {data.executionOrder !== undefined ? (
        <Badge
          variant="outline"
          className={cn(
            'absolute left-2 top-1.5 h-6 min-w-6 shrink-0 justify-center px-1 text-[11px] font-bold tabular-nums shadow-sm',
            getStepNumberTone(data.stepStatus ?? 'pending', selected),
          )}
        >
          {data.executionOrder + 1}
        </Badge>
      ) : null}
      {data.stepStatus ? (
        <div className="absolute right-2 top-1.5 z-10">
          <PlaybookStatusBadge status={data.stepStatus} size="xs" />
        </div>
      ) : null}
      <div className="flex h-full items-center gap-3 px-3 pt-3">
        <span className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground',
          data.kind === 'router' && 'rotate-45 rounded-md bg-primary/10 text-primary',
        )}>
          <Icon className={cn('h-4 w-4', data.kind === 'router' && '-rotate-45')} />
        </span>
        <div className="min-w-0 flex-1 pt-3">
          <Tooltip open={titleTooltipOpen && titleTruncated} onOpenChange={setTitleTooltipOpen}>
            <TooltipTrigger asChild>{titleElement}</TooltipTrigger>
            {titleTruncated ? (
              <TooltipContent side="top" className="max-w-80 text-pretty">
                {title}
              </TooltipContent>
            ) : null}
          </Tooltip>
          <div className={cn('mt-1 truncate text-[10px] text-muted-foreground', data.canExecute && 'pr-8')}>
            {subtitle}
          </div>
        </div>
      </div>
      {data.canExecute ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="nodrag nopan absolute bottom-1.5 right-1.5 z-10 h-7 w-7 text-muted-foreground hover:text-primary"
              disabled={playDisabled}
              aria-label={t('node.executeStep')}
              onClick={(event) => {
                event.stopPropagation();
                data.onExecute?.(id);
              }}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('node.executeStep')}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
