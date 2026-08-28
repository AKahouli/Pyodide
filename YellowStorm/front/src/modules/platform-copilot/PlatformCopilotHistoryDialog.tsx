import * as React from 'react';
import { Check, History, Loader2, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useModuleTranslation } from '@/modules/localization';
import type { Conversation } from '@/modules/conversation/types';

export function PlatformCopilotHistoryDialog({
  open,
  onOpenChange,
  conversations,
  activeConversationId,
  loading,
  onSelect,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversations: Conversation[];
  activeConversationId?: string;
  loading: boolean;
  onSelect: (id: string) => Promise<boolean>;
}>) {
  const { t, language } = useModuleTranslation('platform-copilot');
  const [query, setQuery] = React.useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase(language);
  const filtered = conversations.filter((conversation) => !normalizedQuery
    || conversation.title.toLocaleLowerCase(language).includes(normalizedQuery));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex max-h-[80vh] w-[calc(100%_-_2rem)] max-w-md flex-col overflow-hidden'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'><History className='size-4' />{t('history.title')}</DialogTitle>
          <DialogDescription>{t('history.description')}</DialogDescription>
        </DialogHeader>
        <label htmlFor='yellowmind-history-search' className='sr-only'>{t('history.search')}</label>
        <Input id='yellowmind-history-search' value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('history.search')} />
        <div className='min-h-0 flex-1 space-y-2 overflow-y-auto pr-1'>
          {loading && <div className='flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground'><Loader2 className='size-4 animate-spin' />{t('history.loading')}</div>}
          {!loading && filtered.length === 0 && <p className='py-8 text-center text-sm text-muted-foreground'>{t('history.empty')}</p>}
          {!loading && filtered.map((conversation) => {
            const active = conversation.id === activeConversationId;
            const dateValue = conversation.lastMessageAt || conversation.updatedAt || conversation.createdAt;
            const date = dateValue ? new Date(dateValue) : null;
            return (
              <Button
                key={conversation.id}
                type='button'
                variant={active ? 'secondary' : 'ghost'}
                className='h-auto min-h-14 w-full justify-start gap-3 px-3 py-2 text-left'
                aria-current={active ? 'true' : undefined}
                onClick={() => { void onSelect(conversation.id).then((selected) => { if (selected) onOpenChange(false); }); }}
              >
                <MessageSquare className='size-4 shrink-0 text-muted-foreground' />
                <span className='min-w-0 flex-1'>
                  <span className='block truncate text-sm font-medium'>{conversation.title}</span>
                  {date && !Number.isNaN(date.getTime()) && <span className='block text-xs font-normal text-muted-foreground'>{new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(date)}</span>}
                </span>
                {active && <Check className='size-4 shrink-0 text-primary' aria-label={t('history.current')} />}
              </Button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
