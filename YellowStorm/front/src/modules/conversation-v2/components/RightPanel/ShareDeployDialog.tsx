import { useEffect, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { conversationV2Api } from '../../api';
import { useConversationV2Translation } from '../../translation';
import type { UserSearchResult } from '../../types';

export interface ShareDeployDialogProps {
  sessionId: string;
  deployedUrl: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function userLabel(u: UserSearchResult): string {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return name || u.email;
}

function initials(u: UserSearchResult): string {
  return (u.firstName?.[0] ?? u.email[0] ?? '?').toUpperCase();
}

/** Modal to share a deployed app with one or more users (search + chips). */
export function ShareDeployDialog({
  sessionId,
  deployedUrl,
  open,
  onOpenChange,
}: ShareDeployDialogProps) {
  const { t } = useConversationV2Translation();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<UserSearchResult[]>([]);
  const [sending, setSending] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setSelected([]);
      setSearching(false);
    }
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      try {
        const r = await conversationV2Api.searchUsers(q);
        if (id === requestId.current) setResults(r);
      } catch {
        if (id === requestId.current) setResults([]);
      } finally {
        if (id === requestId.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const addUser = (u: UserSearchResult) => {
    setSelected((prev) => (prev.some((x) => x.id === u.id) ? prev : [...prev, u]));
    setQuery('');
    setResults([]);
  };
  const removeUser = (id: string) => setSelected((prev) => prev.filter((u) => u.id !== id));

  const handleSend = async () => {
    if (selected.length === 0) return;
    setSending(true);
    try {
      const result = await conversationV2Api.shareDeployedApp(
        sessionId,
        selected.map((u) => u.email),
      );
      if (result.sent === 0) {
        toast.error(t('toasts.share.error'));
        return;
      }
      toast.success(t('toasts.share.success'));
      onOpenChange(false);
    } catch {
      toast.error(t('toasts.share.error'));
    } finally {
      setSending(false);
    }
  };

  const showResults = query.trim().length >= 3;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>{t('share.title')}</DialogTitle>
          <DialogDescription className='truncate'>{deployedUrl}</DialogDescription>
        </DialogHeader>

        <div className='relative'>
          <Search className='pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground' />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('share.searchPlaceholder')}
            className='pl-8'
            autoFocus
          />
          {showResults && (
            <div className='absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md'>
              {searching ? (
                <div className='flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground'>
                  <Loader2 className='size-4 animate-spin' />
                  {t('share.searching')}
                </div>
              ) : results.length === 0 ? (
                <div className='px-2 py-3 text-sm text-muted-foreground'>{t('share.noResults')}</div>
              ) : (
                results.map((u) => (
                  <button
                    key={u.id}
                    type='button'
                    onClick={() => addUser(u)}
                    className='flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent'
                  >
                    <span className='flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium'>
                      {initials(u)}
                    </span>
                    <span className='flex min-w-0 flex-col'>
                      <span className='truncate'>{userLabel(u)}</span>
                      <span className='truncate text-xs text-muted-foreground'>{u.email}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {selected.length > 0 && (
          <div className='flex flex-wrap gap-1.5'>
            {selected.map((u) => (
              <span
                key={u.id}
                className='inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-xs'
              >
                {u.email}
                <button
                  type='button'
                  onClick={() => removeUser(u.id)}
                  className='text-muted-foreground hover:text-foreground'
                  aria-label={t('share.remove')}
                >
                  <X className='size-3' />
                </button>
              </span>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant='ghost' onClick={() => onOpenChange(false)}>
            {t('share.cancel')}
          </Button>
          <Button onClick={handleSend} disabled={selected.length === 0 || sending} className='gap-1.5'>
            {sending && <Loader2 className='size-4 animate-spin' />}
            {t('share.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
