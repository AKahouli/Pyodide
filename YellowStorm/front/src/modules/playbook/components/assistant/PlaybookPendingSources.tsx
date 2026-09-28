import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolderSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { usePlatformCopilotPanelStore } from '@/modules/platform-copilot/platformCopilotPanelStore';
import { getPendingPlaybookSources } from '../../assistant-sources-api';
import { PlaybookSourcesCard } from './PlaybookSourcesCard';

/**
 * On the canvas: the source questions Yellowmind is still waiting on for a change to this playbook. The person
 * chooses or skips them here as in the conversation, then continues in Yellowmind, where the message is ready.
 */
export function PlaybookPendingSources({ playbookId }: Readonly<{ playbookId: string }>) {
  const { t } = useModuleTranslation('platform-copilot');
  const openPanel = usePlatformCopilotPanelStore((state) => state.openPanel);
  const [open, setOpen] = useState(false);
  const pending = useQuery({
    queryKey: ['playbook', 'assistant-pending-sources', playbookId],
    queryFn: () => getPendingPlaybookSources(playbookId),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const items = pending.data ?? [];
  if (!items.length) return null;

  if (!open) {
    return (
      <Button type='button' size='sm' variant='outline' className='gap-1.5 rounded-full bg-background/95 shadow-sm' onClick={() => setOpen(true)}>
        <FolderSearch className='size-3.5 text-primary' />
        {t(items.length === 1 ? 'playbookSources.pending_one' : 'playbookSources.pending_other', { count: items.length })}
      </Button>
    );
  }
  return (
    <div className='flex max-h-[70vh] w-[min(26rem,calc(100vw-2rem))] flex-col gap-2 overflow-y-auto rounded-xl border bg-background/95 p-2 shadow-lg'>
      <div className='flex justify-end'>
        <Button type='button' size='sm' variant='ghost' className='h-7 text-xs' onClick={() => setOpen(false)}>{t('playbookSources.pendingHide')}</Button>
      </div>
      {items.map((item) => (
        <PlaybookSourcesCard key={item.continuationId} continuationId={item.continuationId} playbookName={item.playbookName} continueInPanel
          onSend={(text) => { openPanel(text); return true; }} />
      ))}
    </div>
  );
}
