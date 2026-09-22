import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { AgentCardRich } from './AgentCardRich';
import type { Agent } from '../../types';
import type { ViewMode } from '../../hooks/useAgentHubFilters';

interface AgentCardSelectableProps {
  agent: Agent;
  layout: ViewMode;
  selectMode: boolean;
  selected: boolean;
  onSelectChange?: (next: boolean) => void;
  onEdit?: (agent: Agent) => void;
  onDelete?: (agent: Agent) => void;
  onView?: (agent: Agent) => void;
  onDuplicate?: (agent: Agent) => void;
  onPublishA2A?: (agent: Agent) => void;
  onRevokeA2A?: (agent: Agent) => void;
  onShare?: (agent: Agent) => void;
  onUnshare?: (agent: Agent) => void;
  publishingA2A?: boolean;
}

export function AgentCardSelectable({
  agent,
  layout,
  selectMode,
  selected,
  onSelectChange,
  onEdit,
  onDelete,
  onView,
  onDuplicate,
  onPublishA2A,
  onRevokeA2A,
  onShare,
  onUnshare,
  publishingA2A,
}: AgentCardSelectableProps) {
  // Default and shared agents can't be bulk-selected (you don't own them).
  const isSelectable = !agent.isDefault && !agent.shareInfo;

  const handleCardClick = () => {
    if (selectMode && isSelectable) {
      onSelectChange?.(!selected);
    }
  };

  return (
    <div
      className={cn(
        'relative h-full rounded-xl transition',
        layout === 'list' && 'rounded-lg',
        selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
        selectMode && isSelectable && 'cursor-pointer',
        selectMode && !isSelectable && 'opacity-50',
      )}
      onClick={selectMode ? handleCardClick : undefined}
    >
      {selectMode && (
        <div
          className={cn(
            'absolute z-10',
            layout === 'list' ? 'left-3 top-1/2 -translate-y-1/2' : 'left-4 top-4',
          )}
        >
          <Checkbox
            aria-label={agent.name}
            checked={selected}
            disabled={!isSelectable}
            onCheckedChange={(c) => {
              if (isSelectable) onSelectChange?.(c === true);
            }}
            onClick={(e) => e.stopPropagation()}
            className="border-foreground/30 bg-background data-[state=checked]:border-primary"
          />
        </div>
      )}
      <div className={cn('h-full', selectMode && (layout === 'list' ? 'pl-8' : 'pl-6'))}>
        <AgentCardRich
          agent={agent}
          layout={layout}
          onEdit={selectMode ? undefined : onEdit}
          onDelete={selectMode ? undefined : onDelete}
          onView={selectMode ? undefined : onView}
          onDuplicate={selectMode ? undefined : onDuplicate}
          onPublishA2A={selectMode ? undefined : onPublishA2A}
          onRevokeA2A={selectMode ? undefined : onRevokeA2A}
          onShare={selectMode ? undefined : onShare}
          onUnshare={selectMode ? undefined : onUnshare}
          publishingA2A={publishingA2A}
        />
      </div>
    </div>
  );
}
