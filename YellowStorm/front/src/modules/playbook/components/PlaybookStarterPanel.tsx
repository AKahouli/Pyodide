import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useAgents, useAgentStore } from '@/modules/agent/store';
import { useModuleTranslation } from '@/modules/localization';
import { usePlaybookStore } from '../store';
import { buildStarterPlaybook, STARTER_KEYS, type StarterKey } from '../utils/starter-playbooks';

export function PlaybookStarterPanel({ initialKey, onApplied, onDismiss }: {
  initialKey?: string | null; onApplied: (taskIds: string[]) => void; onDismiss: () => void;
}) {
  const { t } = useModuleTranslation('playbook');
  const [key, setKey] = useState<StarterKey>(STARTER_KEYS.includes(initialKey as StarterKey) ? initialKey as StarterKey : 'meeting');
  const [sample, setSample] = useState(() => t(`starter.${key}.sample`));
  const [agentId, setAgentId] = useState('');
  const agents = useAgents();
  const fetchAgents = useAgentStore((state) => state.fetchAgents);
  useEffect(() => { void fetchAgents(); }, [fetchAgents]);
  const apply = () => {
    const state = usePlaybookStore.getState();
    if (!state.currentPlaybook || state.currentPlaybook.tasks.length || !sample.trim()
      || !agents.some((agent) => agent.id === agentId && agent.isActive)) return;
    const definition = buildStarterPlaybook(key, sample, agentId, t);
    state.importPlaybookDefinition({ ...definition, name: state.currentPlaybook.name });
    onApplied(definition.tasks.map((task) => task.id));
  };
  return <section aria-label={t('starter.title')} className="w-full min-w-0 max-w-2xl space-y-4 rounded-xl border bg-background p-5">
    <h2 className="text-lg font-semibold">{t('starter.title')}</h2>
    <p className="text-sm text-muted-foreground">{t('starter.hint')}</p>
    <div className="flex flex-wrap gap-2" role="group" aria-label={t('starter.chooseTemplate')}>
      {STARTER_KEYS.map((value) => <Button key={value} variant={key === value ? 'default' : 'outline'} aria-pressed={key === value}
        onClick={() => { setKey(value); setSample(t(`starter.${value}.sample`)); }}>{t(`starter.${value}.title`)}</Button>)}
    </div>
    <p className="text-sm">{t(`starter.${key}.description`)}</p>
    <label className="block space-y-2 text-sm font-medium">{t('starter.chooseInput')}
      <Textarea value={sample} onChange={(event) => setSample(event.target.value)} rows={5} maxLength={10000} />
    </label>
    <div className="space-y-2"><label id="starter-agent-label" className="text-sm font-medium">{t('nodeEditor.selectAgent')}</label>
      <SearchableSelect aria-labelledby="starter-agent-label" options={agents.filter((agent) => agent.isActive).map((agent) => ({ value: agent.id, label: agent.name }))}
        value={agentId} onValueChange={setAgentId} placeholder={t('nodeEditor.selectAgent')}
        searchPlaceholder={t('nodeEditor.searchAgent')} emptyText={t('nodeEditor.noAgentFound')} />
    </div>
    <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" onClick={onDismiss}>{t('starter.blank')}</Button>
      <Button disabled={!sample.trim() || !agentId} onClick={apply}>{t('starter.use')}</Button></div>
  </section>;
}
