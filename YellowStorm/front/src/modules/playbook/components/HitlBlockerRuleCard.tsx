import { Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useModuleTranslation } from '@/modules/localization';
import type { HitlBlockerRule } from '@/modules/playbook/types';

type HitlBlockerRuleCardProps = Readonly<{
  blocker: HitlBlockerRule;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
  disabled?: boolean;
}>;

/** Renders one business-facing blocker rule with the controls that map directly to backend blocker CRUD. */
export function HitlBlockerRuleCard({ blocker, onToggle, onDelete, disabled = false }: HitlBlockerRuleCardProps) {
  const { t } = useModuleTranslation('playbook');

  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-sm font-medium">{blocker.label}</p>
            <Badge variant={blocker.enabled ? 'secondary' : 'outline'}>
              {blocker.enabled ? t('hitl.blockers.enabled') : t('hitl.blockers.disabled')}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">{blocker.description}</p>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline">{t(`hitl.blockers.action.${blocker.action}`)}</Badge>
            <Badge variant="outline">{t(`hitl.blockers.risk.${blocker.riskLevel}`)}</Badge>
            <Badge variant="outline">{blocker.scope === 'node' ? t('hitl.blockers.scope.node') : t('hitl.blockers.scope.workflow')}</Badge>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Switch checked={blocker.enabled} disabled={disabled} onCheckedChange={onToggle} aria-label={t('hitl.blockers.toggle')} />
          {blocker.createdBy !== 'system' && (
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={disabled} onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
