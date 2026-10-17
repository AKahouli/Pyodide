import './devtools-off';
import { useContext, useId } from 'react';
import { FormNameContext, useFormName, useIsStreaming, useStateField, useTriggerAction } from '@openuidev/react-lang';
import { isReactiveAssign, type ASTNode } from '@openuidev/lang-core';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { MiniAppAutosaveContext, OpenUiSubmissionContext } from './actions';
import { MiniApp, MiniInput, MiniSelect, MiniToggle, MiniButton, MiniOutput, MiniList } from './mini-app-definitions';
import { miniAppTaskComponents } from './mini-app-task';

function asksAgent(action: unknown): boolean {
  if (!action || typeof action !== 'object') return false;
  if ('type' in action && action.type === 'AskAgent') return true;
  return 'steps' in action && Array.isArray(action.steps) && action.steps.some(step =>
    step && typeof step === 'object' && step.type === 'custom_action' && step.name === 'AskAgent');
}

/** Substitute only the scoped input value; keep the SDK's binding expression and action evaluator. */
function withNullInput(node: ASTNode): ASTNode {
  const replace = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(replace);
    if (!value || typeof value !== 'object') return value;
    if ('k' in value && value.k === 'StateRef' && 'n' in value && value.n === '$value') return { k: 'Null' };
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replace(child)]));
  };
  return replace(node) as ASTNode;
}

export const miniAppComponents = [
  ...miniAppTaskComponents,
  { ...MiniApp, component: ({ props, renderNode }: Parameters<typeof MiniApp.component>[0]) => {
    const { t } = useModuleTranslation('conversation');
    const status = useContext(OpenUiSubmissionContext)[props.name];
    const autosave = useContext(MiniAppAutosaveContext);
    const streaming = useIsStreaming();
    return <FormNameContext.Provider value={props.name}>
      <form aria-label={props.title} onSubmit={event => event.preventDefault()} className='space-y-4 py-2'>
        <header><h3 className='text-lg font-semibold'>{props.title}</h3><p className='text-sm text-muted-foreground'>{props.description}</p></header>
        <fieldset disabled={streaming || status === 'submitting'} aria-busy={status === 'submitting'} className='min-w-0 space-y-4'>{renderNode(props.children)}</fieldset>
        <p className='text-xs text-muted-foreground'>{t(autosave ? 'openui.miniApp.autosaveHint' : 'openui.miniApp.localState')}</p>
        {status && <p role={status === 'error' ? 'alert' : 'status'} className='text-sm'>{t(`openui.interaction.${status}`)}</p>}
      </form>
    </FormNameContext.Provider>;
  } },
  { ...MiniInput, component: ({ props }: Parameters<typeof MiniInput.component>[0]) => {
    const id = useId(); const field = useStateField(props.name, props.value);
    const trigger = useTriggerAction(); const formName = useFormName();
    const setNumber = (value: number | null) => {
      if (value === null && isReactiveAssign(props.value)) {
        // OpenUI 1.0.1 resolves a null scoped $value through ?? to missing state.
        // Keep the normal binding expression, but make its null fallback explicit.
        trigger(props.label, formName, { steps: [{ type: 'set', target: props.value.target, valueAST: withNullInput(props.value.expr) }] });
      } else field.setValue(value);
    };
    const value = typeof field.value === 'string' || typeof field.value === 'number' ? field.value : '';
    return <div className='space-y-1.5'><label htmlFor={id} className='text-sm font-medium'>{props.label}</label>
      {props.kind === 'textarea'
        ? <Textarea id={id} name={props.name} value={value} required={props.required} maxLength={5000} rows={5} onChange={event => field.setValue(event.target.value)} />
        : <Input id={id} name={props.name} type={props.kind} value={value} required={props.required} min={props.min} max={props.max} maxLength={5000} step={props.kind === 'number' ? 'any' : undefined}
          onChange={event => props.kind === 'number' ? setNumber(Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : null) : field.setValue(event.target.value)} />}
    </div>;
  } },
  { ...MiniSelect, component: ({ props }: Parameters<typeof MiniSelect.component>[0]) => {
    const id = useId(); const field = useStateField(props.name, props.value);
    return <div className='space-y-1.5'><label htmlFor={id} className='text-sm font-medium'>{props.label}</label>
      <select id={id} name={props.name} value={typeof field.value === 'string' ? field.value : ''} onChange={event => field.setValue(event.target.value)} className='h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50'>
        {props.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>;
  } },
  { ...MiniToggle, component: ({ props }: Parameters<typeof MiniToggle.component>[0]) => {
    const field = useStateField(props.name, props.value);
    return <label className='flex items-center gap-2 text-sm'><input type='checkbox' name={props.name} checked={field.value === true} onChange={event => field.setValue(event.target.checked)} className='size-4 accent-primary focus-visible:ring-1 focus-visible:ring-ring' />{props.label}</label>;
  } },
  { ...MiniButton, component: ({ props }: Parameters<typeof MiniButton.component>[0]) => {
    const trigger = useTriggerAction(); const formName = useFormName();
    return <Button type='button' onClick={event => {
      if ((props.validate || asksAgent(props.action)) && !event.currentTarget.closest('form')?.reportValidity()) return;
      trigger(props.label, formName, props.action);
    }}>{props.label}</Button>;
  } },
  { ...MiniOutput, component: ({ props }: Parameters<typeof MiniOutput.component>[0]) => {
    const { t } = useModuleTranslation('conversation');
    const value = props.value == null ? t('openui.miniApp.emptyResult') : typeof props.value === 'object' ? JSON.stringify(props.value) : String(props.value);
    return <div className='space-y-1'><p className='text-sm font-medium'>{props.label}</p><output aria-label={props.label} className='block max-w-prose whitespace-pre-wrap break-words text-sm tabular-nums'>{value}</output></div>;
  } },
  { ...MiniList, component: ({ props }: Parameters<typeof MiniList.component>[0]) => Array.isArray(props.items) && props.items.length
    ? <ul className='list-disc space-y-1 break-words pl-5 text-sm'>{props.items.map((item, index) => <li key={index}>{item}</li>)}</ul>
    : <p role='status' className='text-sm text-muted-foreground'>{props.emptyText}</p> },
];
