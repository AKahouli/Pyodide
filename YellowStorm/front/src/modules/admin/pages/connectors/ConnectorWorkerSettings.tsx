import { useState } from 'react';
import { useModuleTranslation } from '@/modules/localization';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ConnectorActionResponse, ConnectorWorkerPolicy } from '../../types';

interface Props {
  policy: ConnectorWorkerPolicy;
  actions: ConnectorActionResponse[];
  onPolicyChange: (policy: ConnectorWorkerPolicy) => void;
  onActionsChange: (actions: ConnectorActionResponse[]) => void;
}

export function ConnectorWorkerSettings({ policy, actions, onPolicyChange, onActionsChange }: Props) {
  const { t } = useModuleTranslation('admin');
  const [search, setSearch] = useState('');
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const update = (key: string, patch: Partial<ConnectorActionResponse>) =>
    onActionsChange(actions.map((action) => action.key === key ? { ...action, ...patch } : action));
  const visible = actions.filter((action) =>
    `${action.label} ${action.key}`.toLowerCase().includes(search.toLowerCase())
    && (!exceptionsOnly || (action.workerAccess ?? 'inherit') !== 'inherit'
      || !['inherit', undefined].includes(action.executionKind)));

  return <section className='min-w-0 space-y-4 border-t pt-4' aria-labelledby='connector-workers-heading'>
    <div>
      <h3 id='connector-workers-heading' className='font-medium'>{t('connectors.workers.title')}</h3>
      <p className='mt-1 text-sm text-muted-foreground'>{t('connectors.workers.description')}</p>
    </div>
    <div className='flex items-center justify-between gap-4'>
      <Label htmlFor='connector-worker-default'>{t('connectors.workers.enabled')}</Label>
      <Switch id='connector-worker-default' checked={policy.enabled} onCheckedChange={(enabled) => onPolicyChange({ ...policy, enabled })} />
    </div>
    <div className='space-y-1'>
      <Label htmlFor='connector-worker-kind'>{t('connectors.workers.defaultKind')}</Label>
      <Select value={policy.defaultExecutionKind} onValueChange={(defaultExecutionKind: 'leaf' | 'unknown') => onPolicyChange({ ...policy, defaultExecutionKind })}>
        <SelectTrigger id='connector-worker-kind'><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value='leaf'>{t('connectors.workers.kind.leaf')}</SelectItem>
          <SelectItem value='unknown'>{t('connectors.workers.kind.unknown')}</SelectItem>
        </SelectContent>
      </Select>
    </div>
    {actions.some((action) => action.executionKind === 'orchestration') && <div className='flex items-center justify-between gap-4'>
      <Label htmlFor='connector-worker-launch'>{t('connectors.workers.launch')}</Label>
      <Switch id='connector-worker-launch' checked={false} disabled aria-describedby='connector-worker-launch-help' />
    </div>}
    <p id='connector-worker-launch-help' className='text-sm text-muted-foreground'>{t('connectors.workers.launchLimit')}</p>
    {actions.some((action) => action.executionKind === 'unknown') && <Button type='button' variant='outline' size='sm' onClick={() => onActionsChange(actions.map((action) => action.executionKind === 'unknown' ? { ...action, executionKind: 'inherit' } : action))}>
      {t('connectors.workers.adoptDefault')}
    </Button>}
    <div className='flex flex-wrap items-center gap-3'>
      <Input className='min-w-0 flex-1' value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('connectors.workers.search')} aria-label={t('connectors.workers.search')} />
      <div className='flex items-center gap-2'>
        <Switch id='connector-worker-exceptions' checked={exceptionsOnly} onCheckedChange={setExceptionsOnly} />
        <Label htmlFor='connector-worker-exceptions'>{t('connectors.workers.exceptions')}</Label>
      </div>
    </div>
    <div className='max-h-72 space-y-3 overflow-y-auto'>
      {visible.map((action) => <div key={action.key} className='grid gap-2 border-b pb-3 sm:grid-cols-[minmax(0,1fr)_150px_180px]'>
        <div className='min-w-0'>
          <p className='break-words text-sm font-medium'>{action.label || action.key}</p>
          <p className='text-xs text-muted-foreground'>{t(`connectors.workers.safety.${action.safety === 'write' || action.safety === 'delete' ? action.safety : 'read'}`)}</p>
        </div>
        <Select value={action.workerAccess ?? 'inherit'} onValueChange={(workerAccess: 'inherit' | 'allow' | 'block') => update(action.key, { workerAccess })}>
          <SelectTrigger aria-label={t('connectors.workers.accessLabel', { tool: action.label || action.key })}><SelectValue /></SelectTrigger>
          <SelectContent>{(['inherit', 'allow', 'block'] as const).map((value) => <SelectItem key={value} value={value}>{t(`connectors.workers.access.${value}`, { state: t(`connectors.workers.access.${policy.enabled ? 'allow' : 'block'}`) })}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={action.executionKind ?? 'inherit'} onValueChange={(executionKind) => update(action.key, { executionKind: executionKind as ConnectorActionResponse['executionKind'] })}>
          <SelectTrigger aria-label={t('connectors.workers.kindLabel', { tool: action.label || action.key })}><SelectValue /></SelectTrigger>
          <SelectContent>{(['inherit', 'leaf', 'orchestration', 'unknown'] as const).map((value) => <SelectItem key={value} value={value}>{t(`connectors.workers.kind.${value}`)}</SelectItem>)}</SelectContent>
        </Select>
      </div>)}
      {!visible.length && <p className='text-sm text-muted-foreground'>{t('connectors.workers.empty')}</p>}
    </div>
  </section>;
}
