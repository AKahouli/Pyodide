import { useMemo } from 'react';
import { Cable, Loader2, Plug, Settings2 } from 'lucide-react';
import {
  PromptInputActionMenuSub,
  PromptInputActionMenuSubContent,
  PromptInputActionMenuSubTrigger,
} from '@/components/ai-elements/prompt-input';
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { useModuleTranslation } from '@/modules/localization';
import type { ConnectorOption } from '@/modules/agent/api';
import { ConnectorLogo } from './ConnectorLogo';
import { useRecentConnectors } from '../useRecentConnectors';
import { useConnectorConnections } from '../useConnectorConnections';

const SYSTEM_CATEGORY_NAME = 'system';
const MAX_VISIBLE = 5;

interface RecentConnectorsMenuProps {
  connectors: ConnectorOption[];
  loading: boolean;
  /** Selecting a connected (or auth-less) connector to use it in the conversation. */
  onSelectConnector: (connector: ConnectorOption) => void;
  /** Opens the full management modal. */
  onOpenManage: () => void;
}

/**
 * The "+ → Connectors" submenu: shows recently-used connectors (logo, name,
 * connect/connected action) and a persistent "Manage connectors" entry.
 */
export function RecentConnectorsMenu({ connectors, loading, onSelectConnector, onOpenManage }: RecentConnectorsMenuProps) {
  const { t } = useModuleTranslation('common');
  const { recentIds } = useRecentConnectors();
  const { getStatus, connect } = useConnectorConnections();

  const nonSystem = useMemo(
    () => connectors.filter((c) => (c.categoryName ?? '').toLowerCase() !== SYSTEM_CATEGORY_NAME),
    [connectors],
  );

  // Recently-used first (in stored order); fall back to the first few available connectors.
  const recentConnectors = useMemo(() => {
    const byId = new Map(nonSystem.map((c) => [c.id, c]));
    const ordered = recentIds.map((id) => byId.get(id)).filter((c): c is ConnectorOption => Boolean(c));
    if (ordered.length > 0) return ordered.slice(0, MAX_VISIBLE);
    return nonSystem.slice(0, MAX_VISIBLE);
  }, [nonSystem, recentIds]);

  // Recording into recents is centralized in the parent (covers menu + modal "Use").
  const handleSelect = (connector: ConnectorOption) => {
    onSelectConnector(connector);
  };

  return (
    <PromptInputActionMenuSub>
      <PromptInputActionMenuSubTrigger>
        <Cable className='mr-2 size-4' /> {t('input.connectors') || 'Connectors'}
      </PromptInputActionMenuSubTrigger>
      <PromptInputActionMenuSubContent className='min-w-64'>
        <DropdownMenuLabel className='text-xs font-normal text-muted-foreground'>
          {t('connectors.recent') || 'Recent connectors'}
        </DropdownMenuLabel>
        {loading ? (
          <div className='flex items-center justify-center py-2'>
            <Loader2 className='size-4 animate-spin' />
          </div>
        ) : recentConnectors.length === 0 ? (
          <div className='px-2 py-2 text-sm text-muted-foreground'>
            {t('input.noConnectors') || 'No connectors available'}
          </div>
        ) : (
          recentConnectors.map((connector) => {
            const status = getStatus(connector);
            const needsConnect = status.requiresAuth && !status.connected;
            return (
              <DropdownMenuItem
                key={connector.id}
                className='gap-2'
                onSelect={(e) => {
                  if (needsConnect) {
                    // Keep the menu open while the OAuth popup runs.
                    e.preventDefault();
                    void connect(connector);
                  } else {
                    handleSelect(connector);
                  }
                }}
              >
                <ConnectorLogo connector={connector} size={24} />
                <span className='flex-1 truncate font-medium'>{connector.name}</span>
                {needsConnect ? (
                  <span className='inline-flex items-center gap-1 text-xs text-primary'>
                    {status.connecting ? <Loader2 className='size-3 animate-spin' /> : <Plug className='size-3' />}
                    {t('connectors.connect') || 'Connect'}
                  </span>
                ) : status.requiresAuth ? (
                  <span
                    className='size-2.5 shrink-0 rounded-full bg-green-500'
                    title={t('connectors.connected') || 'Connected'}
                    aria-label={t('connectors.connected') || 'Connected'}
                  />
                ) : null}
              </DropdownMenuItem>
            );
          })
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem className='gap-2' onSelect={() => onOpenManage()}>
          <Settings2 className='size-4' />
          {t('connectors.manage') || 'Manage connectors'}
        </DropdownMenuItem>
      </PromptInputActionMenuSubContent>
    </PromptInputActionMenuSub>
  );
}
