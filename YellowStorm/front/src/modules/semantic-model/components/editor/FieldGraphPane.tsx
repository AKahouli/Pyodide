import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useModuleTranslation } from '@/modules/localization';
import { GRAPH_MAX_CHARS_RANGE, cleanFieldGraph, withGraph } from '../../graphSettings';
import type { AttributeDefinition } from '../../types';

/**
 * Whether a field is shown in the graph. A hidden field is left out of the graph only: it stays searchable,
 * and visible in the records, the record details and the health check. A long text can be cut instead.
 */
export function FieldGraphPane({ attribute, onChange, disabled }: Readonly<{
  attribute: AttributeDefinition;
  onChange: (next: AttributeDefinition) => void;
  disabled?: boolean;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const settings = cleanFieldGraph(attribute.graph);
  const shown = settings?.expose !== false;
  const [min, max] = GRAPH_MAX_CHARS_RANGE;
  const id = `graph-${attribute.key}`;
  const change = (next: Parameters<typeof withGraph>[1]) => onChange(withGraph(attribute, next));
  return <div className='space-y-2 rounded-lg border border-dashed px-2.5 py-2'>
    <div className='flex items-center justify-between gap-2'>
      <Label htmlFor={id} className='text-xs font-medium'>{t('attributes.graph.title')}</Label>
      <Switch id={id} checked={shown} disabled={disabled} aria-label={t('attributes.graph.switchFor', { name: attribute.label })}
        onCheckedChange={(checked) => change({ ...settings, expose: checked ? undefined : false })} />
    </div>
    <p className='text-[11px] text-muted-foreground'>{t('attributes.graph.hint')}</p>
    {shown && attribute.type === 'text' && <div className='flex items-center gap-2'>
      <Label htmlFor={`${id}-max`} className='shrink-0 text-[11px] font-normal text-muted-foreground'>{t('attributes.graph.maxChars')}</Label>
      <Input id={`${id}-max`} type='number' inputMode='numeric' className='h-7 w-24 text-xs' min={min} max={max} disabled={disabled}
        defaultValue={settings?.maxChars ?? ''} placeholder={t('attributes.graph.maxCharsPlaceholder')}
        key={settings?.maxChars ?? 'none'}
        onBlur={(event) => {
          const value = event.target.value.trim() === '' ? undefined : Math.round(Number(event.target.value));
          // Out of range or not a number: back to what is stored rather than keeping a value the server refuses.
          if (value !== undefined && (!Number.isFinite(value) || value < min || value > max)) { event.target.value = String(settings?.maxChars ?? ''); return; }
          change({ ...settings, maxChars: value });
        }} />
    </div>}
  </div>;
}
