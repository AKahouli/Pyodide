import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAgents, useAgentStore, useAgentsLoading, type Agent } from '@/modules/agent';
import { useModuleTranslation } from '@/modules/localization';

interface Props {
  selectedAgentIds: string[];
  onChange: (agentIds: string[]) => void;
}

export function GovernanceAgentSelector({ selectedAgentIds, onChange }: Readonly<Props>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const agents = useAgents();
  const isLoading = useAgentsLoading();
  const fetchAgents = useAgentStore((state) => state.fetchAgents);
  const [search, setSearch] = useState('');

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  const toggleAgent = (agentId: string) => {
    onChange(selectedAgentIds.includes(agentId) ? selectedAgentIds.filter((id) => id !== agentId) : [...selectedAgentIds, agentId]);
  };

  const normalizedSearch = search.trim().toLowerCase();
  const visibleAgents = normalizedSearch
    ? agents.filter((agent) => `${agent.name} ${agent.agentType.name} ${agent.role}`.toLowerCase().includes(normalizedSearch))
    : agents;

  return (
    <div className='grid gap-2'>
      <Input aria-label={t('scopeShell.agents.search')} placeholder={t('scopeShell.agents.search')} value={search} onChange={(event) => setSearch(event.target.value)} />
      <div className='grid max-h-72 gap-2 overflow-y-auto rounded-xl border bg-background p-2 md:grid-cols-2'>
        {visibleAgents.map((agent) => <AgentOption key={agent.id} agent={agent} isSelected={selectedAgentIds.includes(agent.id)} onSelect={() => toggleAgent(agent.id)} />)}
        {!isLoading && visibleAgents.length === 0 && <p className='p-2 text-sm text-muted-foreground'>{t('scopeShell.agents.noAgents')}</p>}
        {isLoading && <p className='p-2 text-sm text-muted-foreground'>{t('scopeShell.agents.loadingAgents')}</p>}
      </div>
      <p className='text-xs text-muted-foreground'>{t('scopeShell.agents.selectionHelp')}</p>
    </div>
  );
}

function AgentOption({ agent, isSelected, onSelect }: Readonly<{ agent: Agent; isSelected: boolean; onSelect: () => void }>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  return (
    <Button type='button' variant={isSelected ? 'default' : 'ghost'} className='h-auto justify-start px-3 py-2 text-left' onClick={onSelect}>
      <span className='min-w-0'>
        <span className='block truncate font-medium'>{agent.name}</span>
        <span className='block truncate text-xs opacity-80'>{agent.agentType.name} · {agent.isActive ? t('scopeShell.agents.active') : t('scopeShell.agents.inactive')}</span>
      </span>
    </Button>
  );
}

export function GovernanceAgentName({ agentId }: Readonly<{ agentId: string }>): JSX.Element {
  const agents = useAgents();
  const agent = agents.find((item) => item.id === agentId);
  return <>{agent?.name ?? agentId}</>;
}
