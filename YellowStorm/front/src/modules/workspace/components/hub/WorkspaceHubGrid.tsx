import { cn } from '@/lib/utils';
import type {
  WorkspaceHubFilteredGroups,
  WorkspaceHubItem,
  ViewMode,
} from '../../hooks/useWorkspaceHubFilters';
import { WorkspaceCard } from './WorkspaceCard';
import { useModuleTranslation } from '@/modules/localization';

interface WorkspaceHubGridProps {
  groups: WorkspaceHubFilteredGroups;
  view: ViewMode;
  onOpen: (id: string) => void;
  onSettings: (id: string) => void;
  onShare: (id: string) => void;
  onDelete: (workspace: WorkspaceHubItem) => void;
}

export function WorkspaceHubGrid({
  groups,
  view,
  onOpen,
  onSettings,
  onShare,
  onDelete,
}: Readonly<WorkspaceHubGridProps>) {
  const { t } = useModuleTranslation('workspace');
  const sections: Array<{ key: string; title: string; items: WorkspaceHubItem[] }> = [
    { key: 'personal', title: t('hub.owner.personal'), items: groups.personal },
    { key: 'mine', title: t('hub.owner.mine'), items: groups.mine },
    { key: 'shared', title: t('hub.owner.shared'), items: groups.shared },
    { key: 'public', title: t('hub.owner.public'), items: groups.public },
  ];

  return (
    <div className="space-y-10">
      {sections.map((section) =>
        section.items.length > 0 ? (
          <section key={section.key} className="space-y-4">
            <header className="flex items-baseline gap-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {section.title}
              </h2>
              <span className="h-px flex-1 bg-border/80" />
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {t(`hub.workspaceCount_${section.items.length === 1 ? 'one' : 'other'}`, { count: section.items.length })}
              </span>
            </header>
            <div
              className={cn(
                view === 'grid'
                  ? 'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'
                  : 'flex flex-col gap-2',
              )}
            >
              {section.items.map((workspace) => (
                <WorkspaceCard
                  key={workspace.id}
                  workspace={workspace}
                  layout={view}
                  onOpen={onOpen}
                  onSettings={onSettings}
                  onShare={onShare}
                  onDelete={onDelete}
                />
              ))}
            </div>
          </section>
        ) : null,
      )}
    </div>
  );
}
