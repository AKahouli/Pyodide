import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { Agent } from '../../types';
import type {
  AgentHubFilteredGroups,
  ViewMode,
} from '../../hooks/useAgentHubFilters';
import { AgentCardSelectable } from './AgentCardSelectable';

interface AgentHubGridProps {
  groups: AgentHubFilteredGroups;
  view: ViewMode;
  selectMode: boolean;
  selectedIds: Set<string>;
  onSelectChange: (id: string, next: boolean) => void;
  onEdit: (agent: Agent) => void;
  onDelete: (agent: Agent) => void;
  onView: (agent: Agent) => void;
  onDuplicate: (agent: Agent) => void;
  onPublishA2A: (agent: Agent) => void;
  publishingA2AId: string | null;
}

export function AgentHubGrid({
  groups,
  view,
  selectMode,
  selectedIds,
  onSelectChange,
  onEdit,
  onDelete,
  onView,
  onDuplicate,
  onPublishA2A,
  publishingA2AId,
}: AgentHubGridProps) {
  const { t } = useModuleTranslation('agent');

  const sections: Array<{ key: string; title: string; agents: Agent[] }> = [
    { key: 'personal', title: t('hub.sections.personal'), agents: groups.personal },
    { key: 'defaults', title: t('hub.sections.defaults'), agents: groups.defaults },
  ];

  return (
    <div className="space-y-10">
      {sections.map((section) =>
        section.agents.length > 0 ? (
          <section key={section.key} className="space-y-4">
            <header className="flex items-baseline gap-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {section.title}
              </h2>
              <span className="h-px flex-1 bg-border/80" />
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {section.agents.length === 1
                  ? t('hub.sections.singleAgent')
                  : t('hub.sections.agentsCount', { count: section.agents.length })}
              </span>
            </header>
            <div
              className={cn(
                view === 'grid'
                  ? 'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'
                  : 'flex flex-col gap-2',
              )}
            >
              {section.agents.map((agent) => (
                <AgentCardSelectable
                  key={agent.id}
                  agent={agent}
                  layout={view}
                  selectMode={selectMode}
                  selected={selectedIds.has(agent.id)}
                  onSelectChange={(next) => onSelectChange(agent.id, next)}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onView={onView}
                  onDuplicate={onDuplicate}
                  onPublishA2A={onPublishA2A}
                  publishingA2A={publishingA2AId === agent.id}
                />
              ))}
            </div>
          </section>
        ) : null,
      )}
    </div>
  );
}
