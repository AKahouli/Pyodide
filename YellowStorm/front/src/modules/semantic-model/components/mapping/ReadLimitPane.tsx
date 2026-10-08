import { Gauge } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { AiExtractionSettings } from '../../types';
import { FormField, INPUT } from '../form/FormParts';
import { SettingsPane } from '../settings/SettingsPane';

type LimitKey = 'maxRecords' | 'maxFiles';

/** A value the mapping may choose: a whole number from 1 up to the admin's ceiling. */
export function readLimitProblem(value: number | undefined, ceiling: number | undefined): boolean {
  return value !== undefined && (!Number.isInteger(value) || value < 1 || (ceiling !== undefined && value > ceiling));
}

/**
 * How much of its source a mapping reads: the records of a sheet, or the files of a workspace mapping.
 * Saved with the mapping; left empty, the admin's limit applies, and a value is never above it.
 */
export function ReadLimitPane({ id, limit, ceiling, value, onChange, open, onOpenChange }: Readonly<{
  id: string; limit: LimitKey; ceiling: number | undefined;
  value: Partial<AiExtractionSettings>; onChange: (next: Partial<AiExtractionSettings>) => void;
  open?: boolean; onOpenChange?: (open: boolean) => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const own = value[limit];
  const wrong = readLimitProblem(own, ceiling);
  const shown = (own ?? ceiling)?.toLocaleString() ?? '…';
  return <SettingsPane id={id} open={open} onOpenChange={onOpenChange} attention={wrong}
    title={t('mapping.readLimits.title')} help={t(`mapping.readLimits.${limit}Help`)}
    icon={<Gauge className='h-4 w-4 shrink-0 text-muted-foreground' />}
    summary={t(`mapping.readLimits.${limit}Summary`, { value: shown })}>
    <FormField label={t(`mapping.readLimits.${limit}`)} help={t(`mapping.readLimits.${limit}Help`)} htmlFor={`${id}-${limit}`}>
      <Input id={`${id}-${limit}`} type='number' min={1} max={ceiling} className={cn(INPUT, 'max-w-48')} aria-invalid={wrong}
        value={own ?? ''} placeholder={ceiling === undefined ? '' : String(ceiling)}
        onChange={(event) => {
          const next = { ...value };
          if (event.target.value === '') delete next[limit]; else next[limit] = Number(event.target.value);
          onChange(next);
        }} />
      <p className={cn('text-[11px]', wrong ? 'text-destructive' : 'text-muted-foreground')}>
        {ceiling === undefined ? null : wrong
          ? t('mapping.ai.range', { min: '1', max: ceiling.toLocaleString() })
          : t('dataSources.limits.ceiling', { value: ceiling.toLocaleString() })}
      </p>
    </FormField>
  </SettingsPane>;
}
