import type { ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { FormField, INPUT } from '../form/FormParts';

/** A small ghost button that clears one setting back to its default. */
export function ResetFieldButton({ label, onClick, disabled, compact }: Readonly<{ label: string; onClick: () => void; disabled?: boolean; compact?: boolean }>) {
  const { t } = useModuleTranslation('semantic-model');
  const text = t('searchSettings.resetField', { field: label });
  return <Button type='button' variant='ghost' size='icon' className={cn('shrink-0 text-muted-foreground', compact ? 'h-7 w-7' : 'h-9 w-9')}
    aria-label={text} title={text} onClick={onClick} disabled={disabled}>
    <RotateCcw className='h-3.5 w-3.5' aria-hidden />
  </Button>;
}

/**
 * One number setting: label with its help, the input showing the default as placeholder, a reset
 * button while it is set, and under it the default or the accepted range when the value is wrong.
 */
export function SettingNumberField({ id, label, help, value, placeholder, min, max, step, invalid, onChange, footer }: Readonly<{
  id: string; label: string; help: string; value: number | undefined; placeholder: number;
  min: number; max: number; step?: number; invalid: boolean;
  onChange: (value: number | undefined) => void;
  /** Replaces the default line when the value is valid. */
  footer?: ReactNode;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const format = (number: number) => number.toLocaleString();
  return <FormField label={label} help={help} htmlFor={id}>
    <div className='flex items-center gap-1'>
      <Input id={id} type='number' min={min} max={max} step={step ?? 1} className={INPUT} aria-invalid={invalid}
        value={value ?? ''} placeholder={String(placeholder)}
        onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))} />
      {value !== undefined && <ResetFieldButton label={label} onClick={() => onChange(undefined)} />}
    </div>
    <p className={cn('text-[11px]', invalid ? 'text-destructive' : 'text-muted-foreground')}>
      {invalid
        ? t('mapping.ai.range', { min: format(min), max: format(max) })
        : footer ?? t('settings.builtIn', { value: format(placeholder) })}
    </p>
  </FormField>;
}

/** Sets or removes one key of a partial settings object. */
export function withKey<T extends object, K extends keyof T>(configured: Partial<T>, key: K, value: T[K] | undefined): Partial<T> {
  const next = { ...configured };
  if (value === undefined) delete next[key]; else next[key] = value;
  return next;
}
