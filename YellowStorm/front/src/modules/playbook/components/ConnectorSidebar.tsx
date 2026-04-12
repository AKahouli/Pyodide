import { useCallback, useEffect, useState } from 'react';
import { Cable, ChevronRight, ChevronDown, Plug, Search } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { ConnectorResponse, ConnectorActionResponse } from '@/modules/admin/types';
import apiClient from '@/lib/api/client';
import { toast } from 'sonner';

interface ConnectorWithState extends ConnectorResponse {
  expanded: boolean;
}

interface DragPayload {
  type: 'connector';
  connectorId: string;
  connectorName: string;
  actions: Array<{ key: string; label: string }>;
}

interface ConnectorSidebarProps {
  isOpen: boolean;
  onDragStart: (payload: DragPayload) => void;
}

export function ConnectorSidebar({ isOpen, onDragStart }: ConnectorSidebarProps) {
  const [connectors, setConnectors] = useState<ConnectorWithState[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    async function fetchConnectors() {
      setLoading(true);
      try {
        const response = await apiClient.get('/connectors');
        const data = response.data?.data ?? [];
        if (!cancelled) {
          setConnectors(data.map((c: ConnectorResponse) => ({ ...c, expanded: false })));
        }
      } catch (err) {
        console.error('Failed to fetch connectors:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchConnectors();
    return () => { cancelled = true; };
  }, [isOpen]);

  const toggleExpand = (id: string) => {
    setConnectors((prev) =>
      prev.map((c) => (c.id === id ? { ...c, expanded: !c.expanded } : c)),
    );
  };

  const filtered = search
    ? connectors.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.slug.toLowerCase().includes(search.toLowerCase()),
      )
    : connectors;

  if (!isOpen) return null;

  return (
    <div className='w-64 border-l bg-background flex flex-col h-full'>
      <div className='p-3 border-b'>
        <div className='flex items-center gap-2 mb-3'>
          <Cable className='h-4 w-4 text-muted-foreground' />
          <span className='text-sm font-medium'>Connectors</span>
        </div>
        <div className='relative'>
          <Search className='absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground' />
          <Input
            placeholder='Search...'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className='pl-8 h-8 text-xs'
          />
        </div>
      </div>
      <ScrollArea className='flex-1'>
        {loading ? (
          <div className='flex items-center justify-center py-8'>
            <div className='h-4 w-4 animate-spin border-2 border-muted-foreground border-t-transparent rounded-full' />
          </div>
        ) : filtered.length === 0 ? (
          <div className='py-8 px-3 text-center text-xs text-muted-foreground'>
            {search ? 'No connectors found' : 'No connectors available'}
          </div>
        ) : (
          <div className='p-2 space-y-1'>
            {filtered.map((connector) => (
              <Collapsible
                key={connector.id}
                open={connector.expanded}
                onOpenChange={() => toggleExpand(connector.id)}
              >
                <CollapsibleTrigger asChild>
                  <div
                    className='flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 cursor-grab transition-colors text-sm'
                    draggable
                    onDragStart={(e) => {
                      const enabledActions = connector.actions
                        .filter((a) => a.isEnabled)
                        .map((a) => ({ key: a.key, label: a.label }));
                      const payload: DragPayload = {
                        type: 'connector',
                        connectorId: connector.id,
                        connectorName: connector.name,
                        actions: enabledActions,
                      };
                      e.dataTransfer.setData('application/json', JSON.stringify(payload));
                      e.dataTransfer.effectAllowed = 'copy';
                      onDragStart(payload);
                    }}
                  >
                    <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform', connector.expanded && 'rotate-90')} />
                    <Plug className='h-3.5 w-3.5 text-muted-foreground shrink-0' />
                    <span className='truncate font-medium'>{connector.name}</span>
                    <Badge variant='secondary' className='ml-auto text-[10px] px-1.5 py-0'>
                      {connector.actions.filter((a) => a.isEnabled).length}
                    </Badge>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className='ml-7 mt-0.5 space-y-0.5'>
                    {connector.actions
                      .filter((a) => a.isEnabled)
                      .map((action) => (
                        <div
                          key={action.key}
                          className='flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/30 cursor-grab text-xs text-muted-foreground'
                          draggable
                          onDragStart={(e) => {
                            const payload: DragPayload = {
                              type: 'connector',
                              connectorId: connector.id,
                              connectorName: connector.name,
                              actions: [{ key: action.key, label: action.label }],
                            };
                            e.dataTransfer.setData('application/json', JSON.stringify(payload));
                            e.dataTransfer.effectAllowed = 'copy';
                            onDragStart(payload);
                          }}
                        >
                          <span className='truncate'>{action.label}</span>
                          <Badge variant='outline' className='ml-auto text-[10px] px-1 py-0'>
                            {action.safety}
                          </Badge>
                        </div>
                      ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
