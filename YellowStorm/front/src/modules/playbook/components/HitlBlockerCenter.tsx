import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { useHitlBlockersQuery } from '@/modules/playbook/query/hooks/useHitlQueries';
import { useDeleteHitlBlockerMutation, useUpdateHitlBlockerMutation } from '@/modules/playbook/query/hooks/useHitlMutations';
import { HitlBlockerEditorDialog } from './HitlBlockerEditorDialog';
import { HitlBlockerRuleCard } from './HitlBlockerRuleCard';
import { HitlMemoryPanel } from './HitlMemoryPanel';
import { HitlPolicySummaryCard } from './HitlPolicySummaryCard';

type HitlBlockerCenterProps = Readonly<{
  flowId: string;
  nodeId?: string | null;
  showMemory?: boolean;
}>;

/** Hosts the business-user HITL & Blockers surface while keeping server-owned data in Query caches. */
export function HitlBlockerCenter({ flowId, nodeId = null, showMemory = true }: HitlBlockerCenterProps) {
  const { t } = useModuleTranslation('playbook');
  const blockersQuery = useHitlBlockersQuery(flowId);
  const updateBlocker = useUpdateHitlBlockerMutation();
  const deleteBlocker = useDeleteHitlBlockerMutation();
  const [editorOpen, setEditorOpen] = useState(false);

  const blockers = useMemo(() => {
    const allBlockers = blockersQuery.data ?? [];
    if (!nodeId) return allBlockers.filter((blocker) => blocker.scope === 'workflow');
    return allBlockers.filter((blocker) => blocker.scope === 'node' && blocker.nodeId === nodeId);
  }, [blockersQuery.data, nodeId]);

  return (
    <div className="space-y-4">
      <HitlPolicySummaryCard flowId={flowId} nodeId={nodeId} />
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">{nodeId ? t('hitl.blockers.nodeTitle') : t('hitl.blockers.title')}</p>
            <p className="text-xs text-muted-foreground">{t('hitl.blockers.description')}</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setEditorOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t('hitl.blockers.add')}
          </Button>
        </div>
        {blockers.length === 0 ? (
          <div className="rounded-lg border border-dashed px-3 py-4 text-xs text-muted-foreground">
            {nodeId ? t('hitl.blockers.emptyNode') : t('hitl.blockers.emptyWorkflow')}
          </div>
        ) : (
          <div className="space-y-2">
            {blockers.map((blocker) => (
              <HitlBlockerRuleCard
                key={blocker.id}
                blocker={blocker}
                disabled={updateBlocker.isPending || deleteBlocker.isPending}
                onToggle={(enabled) => updateBlocker.mutate({ flowId, blockerId: blocker.id, data: { enabled } })}
                onDelete={() => deleteBlocker.mutate({ flowId, blockerId: blocker.id })}
              />
            ))}
          </div>
        )}
      </div>
      {showMemory && <HitlMemoryPanel flowId={flowId} />}
      <HitlBlockerEditorDialog flowId={flowId} nodeId={nodeId} open={editorOpen} onOpenChange={setEditorOpen} />
    </div>
  );
}
