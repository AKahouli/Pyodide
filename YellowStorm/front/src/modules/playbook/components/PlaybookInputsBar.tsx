import { Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import type { PlaybookInputContract, PlaybookInputDescriptor } from '../types';

interface Props {
  contract?: PlaybookInputContract;
  loading: boolean;
  canConfigure: boolean;
  canRun: boolean;
  onConfigure: (input: PlaybookInputDescriptor) => void;
  onRun: () => void;
}

export function PlaybookInputsBar({ contract, loading, canConfigure, canRun, onConfigure, onRun }: Readonly<Props>) {
  const { t } = useModuleTranslation('playbook');
  if (loading || !contract) return null;
  const configured = contract.inputs.filter((input) => input.readiness === 'configured').length;
  const configurationInput = contract.inputs.find((input) => input.scope === 'configuration' && input.readiness !== 'configured');
  return (
    <section className="flex flex-col gap-3 border-b bg-muted/20 px-4 py-2 sm:flex-row sm:items-center sm:justify-between" aria-label={t('inputs.title')}>
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Settings2 className="h-4 w-4" />
          <span>{t('inputs.title')}</span>
          <span className="text-muted-foreground">{t('inputs.readyCount', { ready: configured, total: contract.inputs.length })}</span>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {contract.inputs.map((input) => `${input.label}: ${t(`inputs.status.${input.readiness}`)}`).join(' · ') || t('inputs.none')}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {configurationInput ? (
          <Button type="button" size="sm" variant="outline" disabled={!canConfigure} onClick={() => onConfigure(configurationInput)}>
            {t('inputs.configure')}
          </Button>
        ) : null}
        <Button type="button" size="sm" disabled={!canRun || !contract.graphValid || !contract.configurationReady || contract.invalidInputCount > 0} onClick={onRun}>
          {t('inputs.run')}
        </Button>
      </div>
    </section>
  );
}
