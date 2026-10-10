import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { nativeInputLabel } from './native-input-presentation';
import { useModuleTranslation } from '@/modules/localization';
import type { NativeInputSchema } from '../types';

export function encodeNativeInput(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    // ADK unwraps an exact one-key result envelope. Preserve a real object
    // with that shape by putting it inside one additional native envelope.
    return Object.keys(object).length === 1 && Object.hasOwn(object, 'result') ? { result: object } : object;
  }
  return { result: typeof value === 'string' ? JSON.stringify(value) : value };
}

export function NativeInputFields({ schema, value, onChange, label, required = false, disabled = false }: {
  schema: NativeInputSchema; value: unknown; onChange: (value: unknown) => void;
  label: string; required?: boolean; disabled?: boolean;
}) {
  const { t } = useModuleTranslation('conversation');
  label = schema.title || label;
  if (schema.type === 'object') {
    const object = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    return <fieldset disabled={disabled} className='space-y-3'>
      <legend className='text-sm font-medium'>{label}</legend>
      {Object.entries(schema.properties || {}).map(([key, child]) => <NativeInputFields key={key}
        schema={child} label={nativeInputLabel(child, key)} value={object[key]} required={schema.required?.includes(key)} disabled={disabled}
        onChange={(next) => onChange({ ...object, [key]: next })} />)}
    </fieldset>;
  }
  if (schema.type === 'array') {
    const items: unknown[] = Array.isArray(value) ? value : [];
    return <fieldset disabled={disabled} className='space-y-2'>
      <legend className='text-sm font-medium'>{label}</legend>
      {items.map((item, index) => <div key={index} className='flex items-end gap-2'>
        <NativeInputFields schema={schema.items!} label={`${label} ${index + 1}`} value={item} disabled={disabled}
          onChange={(next) => onChange(items.map((old, itemIndex) => itemIndex === index ? next : old))} />
        <Button type='button' variant='outline' disabled={disabled} onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}>
          {t('rootInput.remove')}
        </Button>
      </div>)}
      <Button type='button' variant='outline' disabled={disabled || items.length >= Math.min(20, schema.maxItems ?? 20)} onClick={() => onChange([...items,
        schema.items?.type === 'object' ? {} : schema.items?.type === 'boolean' ? false : schema.items?.type === 'array' ? [] : ''])}>
        {t('rootInput.add')}
      </Button>
    </fieldset>;
  }
  if (schema.enum) return <label className='block space-y-1 text-sm'>
    <span>{label}</span>
    {schema.description && <span className='block text-muted-foreground'>{schema.description}</span>}
    <select className='w-full rounded-md border bg-background p-2' required={required} disabled={disabled}
      value={schema.enum.some((option) => option === value) ? JSON.stringify(value) : ''}
      onChange={(event) => onChange(JSON.parse(event.target.value) as unknown)}>
      <option value='' disabled>{t('rootInput.select')}</option>
      {schema.enum.map((option, index) => <option key={index} value={JSON.stringify(option)}>{String(option)}</option>)}
    </select>
  </label>;
  if (schema.type === 'boolean') return <label className='flex items-center gap-2 text-sm'>
    <Checkbox checked={value === true} disabled={disabled} onCheckedChange={(checked) => onChange(checked === true)} />{label}
  </label>;
  const numeric = schema.type === 'number' || schema.type === 'integer';
  return <div className='space-y-2 text-sm'>
    <label className='block space-y-1'>
    <span>{label}{!required && <span className='ml-2 text-muted-foreground'>{t('rootInput.optional')}</span>}</span>
    {schema.description && <span className='block text-muted-foreground'>{schema.description}</span>}
    {numeric ? <Input type='number' step={schema.type === 'integer' ? 1 : 'any'}
      required={required} disabled={disabled} maxLength={Math.min(2000, schema.maxLength ?? 2000)}
      min={schema.minimum} max={schema.maximum}
      value={typeof value === 'string' || typeof value === 'number' ? value : ''}
      onChange={(event) => onChange(event.target.value !== '' ? Number(event.target.value) : '')} />
      : <Textarea required={required} disabled={disabled} rows={schema.examples?.length ? 2 : 3}
        minLength={schema.minLength} maxLength={Math.min(2000, schema.maxLength ?? 2000)}
        value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} />}
    </label>
    {!!schema.examples?.length && <div className='flex flex-wrap gap-2' role='group' aria-label={t('rootInput.suggestions')}>
      {schema.examples.filter((example) => numeric ? typeof example === 'number' : typeof example === 'string').map((example, index) =>
        <Button key={index} type='button' variant={value === example ? 'secondary' : 'outline'} size='sm'
          className='h-auto min-h-9 max-w-full whitespace-normal text-left' disabled={disabled}
          aria-pressed={value === example} onClick={() => onChange(example)}>{String(example)}</Button>)}
    </div>}
  </div>;
}
