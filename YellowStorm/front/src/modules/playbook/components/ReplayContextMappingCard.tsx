import { Badge } from '@/components/ui/badge';
import { useModuleTranslation } from '@/modules/localization';
import type { ReplayContextMappingEntry } from '../types';

function formatContextValue(value: ReplayContextMappingEntry['currentValue']): string {
  if (value === null) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`;
}

interface Props {
  entries: ReplayContextMappingEntry[];
}

export function ReplayContextMappingCard({ entries }: Props) {
  const { t } = useModuleTranslation('playbook');

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-muted/20 p-4 text-sm">
      <div className="font-medium">{t('replayPlanning.contextTitle')}</div>
      <div className="mt-3 space-y-2">
        {entries.map((entry) => (
          <div key={entry.key} className="rounded-md border bg-background px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{entry.label}</span>
              <Badge variant="outline">{entry.source}</Badge>
              {entry.required && <Badge variant="outline">{t('replayPlanning.required')}</Badge>}
              {!entry.matched && <Badge variant="outline">{t('replayPlanning.missing')}</Badge>}
              {entry.matched && entry.confidence < 0.8 && <Badge variant="outline">{t('replayPlanning.lowConfidence')}</Badge>}
            </div>
            <div className="mt-2 grid gap-1 text-muted-foreground">
              <div>
                <span className="font-medium text-foreground">{t('replayPlanning.baselineValue')}</span>{' '}
                {entry.baselineValue ?? t('replayPlanning.notCaptured')}
              </div>
              <div>
                <span className="font-medium text-foreground">{t('replayPlanning.currentValue')}</span>{' '}
                {entry.matched ? formatContextValue(entry.currentValue ?? entry.value) : t('replayPlanning.unresolved')}
              </div>
              <div>
                <span className="font-medium text-foreground">{t('replayPlanning.confidence')}</span>{' '}
                {formatConfidence(entry.confidence)}
              </div>
              <div>
                <span className="font-medium text-foreground">{t('replayPlanning.reason')}</span>{' '}
                {t(`replayPlanning.reasonValue.${entry.reason}` as any, { defaultValue: entry.reason })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
