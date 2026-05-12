import { useCallback, useEffect, useState } from 'react';
import { Cable, ChevronRight, Plug, Search, ShieldCheck, Link2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ResizablePanel, OverflowTooltip } from '@/components/ui/resizable-panel';
import { cn } from '@/lib/utils';
import type { ConnectorResponse } from '@/modules/admin/types';
import apiClient from '@/lib/api/client';
import { useRequireApp } from '@/modules/connected-app/hooks/useRequireApp';

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

function useOAuthStatus(appKey: string | undefined): {
  isConnected: boolean;
  isConnecting: boolean;
  handleConnect: () => Promise<void>;
} {
  const { isConnected, isConnecting, ensureConnected } = useRequireApp(appKey ?? '');

  const handleConnect = useCallback(async () => {
    if (!appKey) return;
    await ensureConnected();
  }, [appKey, ensureConnected]);

  return { isConnected, isConnecting, handleConnect };
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
    <ResizablePanel
      storageKey="ys_connector_sidebar_width"
      defaultWidth={256}
      minWidth={180}
      maxWidthRatio={0.35}
      handlePosition="right"
      className="border-l bg-background"
    >
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
            {filtered.map((connector) => {
              const isOAuth = connector.authSourceType === 'connected_app' && !!connector.connectedAppKey;
              return (
                <ConnectorCard
                  key={connector.id}
                  connector={connector}
                  isOAuth={isOAuth}
                  onToggleExpand={() => toggleExpand(connector.id)}
                  onDragStart={onDragStart}
                />
              );
            })}
          </div>
        )}
      </ScrollArea>
    </ResizablePanel>
  );
}

function ConnectorCard({
  connector,
  isOAuth,
  onToggleExpand,
  onDragStart,
}: {
  connector: ConnectorWithState;
  isOAuth: boolean;
  onToggleExpand: () => void;
  onDragStart: (payload: DragPayload) => void;
}) {
  const { isConnected, isConnecting, handleConnect } = useOAuthStatus(
    isOAuth ? connector.connectedAppKey : undefined,
  );

  const canDrag = !isOAuth || isConnected;

  const startDrag = (e: React.DragEvent, actions: Array<{ key: string; label: string }>) => {
    if (!canDrag) {
      e.preventDefault();
      return;
    }
    const payload: DragPayload = {
      type: 'connector',
      connectorId: connector.id,
      connectorName: connector.name,
      actions,
    };
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
    onDragStart(payload);
  };

  const enabledActions = connector.actions.filter((a) => a.isEnabled);

  return (
    <Collapsible open={connector.expanded} onOpenChange={onToggleExpand}>
      <CollapsibleTrigger asChild>
        <div
          className={cn(
            'flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors text-sm',
            canDrag
              ? 'hover:bg-muted/50 cursor-grab'
              : 'opacity-60 cursor-not-allowed',
          )}
          draggable={canDrag}
          onDragStart={(e) =>
            startDrag(e, enabledActions.map((a) => ({ key: a.key, label: a.label })))
          }
        >
          <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform', connector.expanded && 'rotate-90')} />
          <Plug className='h-3.5 w-3.5 text-muted-foreground shrink-0' />
          <OverflowTooltip text={connector.name} />

          {isOAuth && (
            isConnected ? (
              <ShieldCheck className='h-3.5 w-3.5 text-green-600 shrink-0 ml-auto' />
            ) : (
              <Link2 className='h-3.5 w-3.5 text-amber-500 shrink-0 ml-auto' />
            )
          )}

          {!isOAuth && (
            <Badge variant='secondary' className='ml-auto text-[10px] px-1.5 py-0'>
              {enabledActions.length}
            </Badge>
          )}

          {isOAuth && !isConnected && (
            <Button
              size='sm'
              variant='ghost'
              className='h-5 px-1.5 text-[10px] ml-auto shrink-0'
              disabled={isConnecting}
              onClick={(e) => {
                e.stopPropagation();
                handleConnect();
              }}
            >
              Connect
            </Button>
          )}
        </div>
      </CollapsibleTrigger>

      {isOAuth && !isConnected && (
        <div className='ml-7 mb-1'>
          <p className='text-[10px] text-muted-foreground'>
            Connect your account to use this connector.
          </p>
        </div>
      )}

      <CollapsibleContent>
        <div className='ml-7 mt-0.5 space-y-0.5'>
          {enabledActions.map((action) => (
            <div
              key={action.key}
              className={cn(
                'flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/30 text-xs text-muted-foreground',
                canDrag ? 'cursor-grab' : 'opacity-40 cursor-not-allowed',
              )}
              draggable={canDrag}
              onDragStart={(e) =>
                startDrag(e, [{ key: action.key, label: action.label }])
              }
            >
              <OverflowTooltip text={action.label} />
              <Badge variant='outline' className='ml-auto text-[10px] px-1 py-0'>
                {action.safety}
              </Badge>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
