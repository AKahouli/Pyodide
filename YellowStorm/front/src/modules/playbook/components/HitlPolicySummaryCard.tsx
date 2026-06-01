import { useEffect, useState } from 'react';
import { Bot, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useModuleTranslation } from '@/modules/localization';
import { useHitlPolicyQuery } from '@/modules/playbook/query/hooks/useHitlQueries';
import { useUpdateHitlPolicyMutation } from '@/modules/playbook/query/hooks/useHitlMutations';
import type { HitlMode, HitlSensitivity } from '@/modules/playbook/types';

type HitlPolicySummaryCardProps = Readonly<{
  flowId: string;
  nodeId?: string | null;
  compact?: boolean;
}>;

/** Displays and edits the Smart HITL policy that the backend persists for a workflow or one node. */
export function HitlPolicySummaryCard({ flowId, nodeId, compact = false }: HitlPolicySummaryCardProps) {
  const { t } = useModuleTranslation('playbook');
  const policyQuery = useHitlPolicyQuery(flowId, nodeId);
  const updatePolicy = useUpdateHitlPolicyMutation();
  const policy = policyQuery.data;
  const [optimisticMode, setOptimisticMode] = useState<HitlMode | null>(null);
  const displayedMode = optimisticMode ?? policy?.mode ?? 'off';
  const isAuto = displayedMode === 'auto';

  const patchPolicy = (data: { mode?: HitlMode; sensitivity?: HitlSensitivity }) => {
    if (data.mode) setOptimisticMode(data.mode);
    updatePolicy.mutate(
      { flowId, nodeId, data },
      { onSettled: () => setOptimisticMode(null) },
    );
  };

  useEffect(() => {
    setOptimisticMode(null);
  }, [flowId, nodeId, policy?.mode]);

  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-2">
          <div className="mt-0.5 rounded-md border bg-muted/50 p-1.5">
            {isAuto ? <Bot className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">{t('hitl.policy.title')}</p>
              {policy?.inheritedFromWorkflow && <Badge variant="outline">{t('hitl.policy.inherited')}</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              {isAuto ? t('hitl.policy.autoHint') : t('hitl.policy.manualHint')}
            </p>
          </div>
        </div>
        <Switch
          checked={isAuto}
          disabled={updatePolicy.isPending}
          onCheckedChange={(checked) => patchPolicy({ mode: checked ? 'auto' : 'off' })}
          aria-label={t('hitl.policy.toggle')}
        />
      </div>
      {!compact && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          <Select
            value={policy?.sensitivity ?? 'balanced'}
            disabled={!policy || updatePolicy.isPending}
            onValueChange={(value) => patchPolicy({ sensitivity: value as HitlSensitivity })}
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="minimal">{t('hitl.sensitivity.minimal')}</SelectItem>
              <SelectItem value="balanced">{t('hitl.sensitivity.balanced')}</SelectItem>
              <SelectItem value="strict">{t('hitl.sensitivity.strict')}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!policy || updatePolicy.isPending}
            onClick={() => patchPolicy({ mode: 'manual' })}
          >
            {t('hitl.policy.manual')}
          </Button>
        </div>
      )}
    </div>
  );
}
