import { useMemo } from 'react';
import { X } from 'lucide-react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import type { ConnectorOption } from '@/modules/agent/api';
import { ConnectorLogo } from './ConnectorLogo';

const MAX_VISIBLE_CONNECTOR_PILLS = 3;

interface SelectedConnectorsPillsProps {
  connectors: ConnectorOption[];
  selectedIds: string[];
  onRemove: (id: string) => void;
}

/**
 * Pills showing the connectors enabled for the conversation: logo + name + a
 * remove button, with the overflow collapsed into a "+N" hover card. Mirrors
 * SelectedSkillsPills so connectors and skills look identical in the composer.
 */
export function SelectedConnectorsPills({ connectors, selectedIds, onRemove }: SelectedConnectorsPillsProps) {
  const selected = useMemo(
    () => selectedIds.map((id) => connectors.find((c) => c.id === id)).filter((c): c is ConnectorOption => Boolean(c)),
    [selectedIds, connectors],
  );
  if (selected.length === 0) return null;

  const visible = selected.slice(0, MAX_VISIBLE_CONNECTOR_PILLS);
  const overflow = selected.slice(MAX_VISIBLE_CONNECTOR_PILLS);

  return (
    <div className='flex flex-wrap items-center gap-1.5 px-1 pt-2'>
      {visible.map((connector) => (
        <span key={connector.id} className='inline-flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pl-1.5 pr-1 text-xs'>
          <ConnectorLogo connector={connector} size={14} />
          <span className='max-w-[140px] truncate'>{connector.name}</span>
          <button
            type='button'
            onClick={() => onRemove(connector.id)}
            className='rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground'
            aria-label={`Retirer ${connector.name}`}>
            <X className='size-3' />
          </button>
        </span>
      ))}
      {overflow.length > 0 && (
        <HoverCard openDelay={100} closeDelay={150}>
          <HoverCardTrigger asChild>
            <span className='inline-flex cursor-default items-center rounded-full border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground'>
              +{overflow.length}
            </span>
          </HoverCardTrigger>
          <HoverCardContent className='w-60 p-1.5'>
            <div className='flex flex-col gap-0.5'>
              {overflow.map((connector) => (
                <div key={connector.id} className='flex items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-muted'>
                  <ConnectorLogo connector={connector} size={14} />
                  <span className='flex-1 truncate'>{connector.name}</span>
                  <button
                    type='button'
                    onClick={() => onRemove(connector.id)}
                    className='rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground'
                    aria-label={`Retirer ${connector.name}`}>
                    <X className='size-3' />
                  </button>
                </div>
              ))}
            </div>
          </HoverCardContent>
        </HoverCard>
      )}
    </div>
  );
}
