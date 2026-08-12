import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ChevronDown, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { StepStatus } from '../../types';
import { PlaybookStatusBadge } from '../PlaybookStatusBadge';

interface RuntimeContainerData extends Record<string, unknown> {
  title: string;
  status: StepStatus;
  generatedCount: number;
  expanded: boolean;
  planning: boolean;
  onToggle?: () => void;
}

export function DynamicReasoningRuntimeContainerNode({ data }: NodeProps) {
  const value = data as RuntimeContainerData;
  const { t } = useModuleTranslation('playbook');
  const toggleLabel = value.expanded
    ? t('executionFocus.container.collapse')
    : t('executionFocus.container.expand');

  return (
    <div className="relative h-full w-full rounded-xl border-2 border-dashed border-primary/35 bg-card/75 shadow-sm backdrop-blur-sm">
      <Handle
        id="dynamic-reasoning-container-target"
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="!h-2.5 !w-2.5 !border-2 !border-background !bg-primary"
      />
      <button
        type="button"
        className="nodrag nopan flex h-16 w-full items-center justify-between gap-3 rounded-t-xl border-b border-border/70 bg-background/90 px-4 text-left"
        onClick={(event) => {
          event.stopPropagation();
          value.onToggle?.();
        }}
        aria-expanded={value.expanded}
        aria-label={`${toggleLabel}: ${value.title}`}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
              {t('executionFocus.container.title')}
            </span>
            <span className="block truncate text-sm font-medium text-foreground">{value.title}</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t('executionFocus.container.generatedCount', { count: value.generatedCount })}
          </span>
          <PlaybookStatusBadge status={value.status} size="xs" />
          <ChevronDown className={cn('h-4 w-4 transition-transform', !value.expanded && '-rotate-90')} />
        </span>
      </button>
      {value.expanded && value.planning ? (
        <div className="flex h-14 items-center px-4 text-sm text-muted-foreground">
          {t('executionFocus.assessing')}
        </div>
      ) : null}
    </div>
  );
}
