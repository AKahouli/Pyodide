import { useMemo, useState } from 'react';
import { Plus, Search, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useAgents } from '@/modules/agent';
import { useModuleTranslation } from '@/modules/localization';

interface AddMemberPopoverProps {
  existingAgentIds: string[];
  onAdd: (agentId: string) => void;
}

export function AddMemberPopover({
  existingAgentIds,
  onAdd,
}: Readonly<AddMemberPopoverProps>) {
  const { t } = useModuleTranslation('team');
  const allAgents = useAgents();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  const existingIds = useMemo(
    () => new Set(existingAgentIds),
    [existingAgentIds],
  );

  const availableAgents = useMemo(() => {
    const filtered = allAgents.filter((a) => !existingIds.has(a.id) && a.isActive);
    if (!search) return filtered;
    const lower = search.toLowerCase();
    return filtered.filter(
      (a) =>
        a.name.toLowerCase().includes(lower) ||
        a.agentType?.name?.toLowerCase().includes(lower),
    );
  }, [allAgents, existingIds, search]);

  const handleSelect = (agentId: string) => {
    onAdd(agentId);
    setOpen(false);
    setSearch('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size='sm' variant='outline'>
          <Plus className='mr-1 h-4 w-4' />
          {t('orgChart.addAgent')}
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-72 p-0' align='start'>
        <div className='p-2 border-b'>
          <div className='relative'>
            <Search className='absolute left-2 top-2.5 h-4 w-4 text-muted-foreground' />
            <Input
              placeholder={t('orgChart.searchAgents')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className='pl-8 h-9'
            />
          </div>
        </div>
        <ScrollArea className='max-h-60'>
          {availableAgents.length === 0 ? (
            <div className='p-4 text-center text-sm text-muted-foreground'>
              {t('orgChart.noAgentsAvailable')}
            </div>
          ) : (
            <div className='p-1'>
              {availableAgents.map((agent) => (
                <button
                  key={agent.id}
                  className='flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-sm hover:bg-accent cursor-pointer text-left'
                  onClick={() => handleSelect(agent.id)}
                >
                  <Bot className='h-4 w-4 shrink-0 text-muted-foreground' />
                  <span className='truncate flex-1'>{agent.name}</span>
                  {agent.agentType?.name && (
                    <Badge variant='secondary' className='text-[10px] shrink-0'>
                      {agent.agentType.name}
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
