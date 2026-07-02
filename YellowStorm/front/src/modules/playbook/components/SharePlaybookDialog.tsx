import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MoreHorizontal, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { showError, showSuccess } from '@/lib/notifications';
import { useAuth } from '@/modules/auth';
import { useModuleTranslation } from '@/modules/localization';
import { searchUsers } from '@/modules/workspace/api';
import type { UserSearchResult } from '@/modules/workspace/types';
import {
  getPlaybookShares,
  revokePlaybookShare,
  sharePlaybook,
  updatePlaybookSharePermission,
} from '../api';
import type { AssignablePlaybookPermission, PlaybookShareEntry } from '../types';

interface SharePlaybookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playbookId: string;
  playbookName: string;
}

interface PendingShare {
  id: string;
  email: string;
  permission: AssignablePlaybookPermission;
}

export function SharePlaybookDialog({ open, onOpenChange, playbookId, playbookName }: Readonly<SharePlaybookDialogProps>) {
  const { t } = useModuleTranslation('playbook');
  const { user } = useAuth();
  const [shares, setShares] = useState<PlaybookShareEntry[]>([]);
  const [pendingShares, setPendingShares] = useState<PendingShare[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRequestRef = useRef(0);

  const userInitials = useMemo(() => {
    if (user?.profile?.firstName && user?.profile?.lastName) {
      return `${user.profile.firstName[0]}${user.profile.lastName[0]}`.toUpperCase();
    }
    return user?.email?.[0]?.toUpperCase() ?? 'Y';
  }, [user]);

  const loadShares = useCallback(async () => {
    setIsLoading(true);
    try {
      setShares(await getPlaybookShares(playbookId));
    } catch {
      showError(t('sharing.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [playbookId, t]);

  useEffect(() => {
    if (open) void loadShares();
  }, [open, loadShares]);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (value.length < 3) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      const requestId = ++activeRequestRef.current;
      try {
        const results = await searchUsers(value);
        if (activeRequestRef.current === requestId) setSearchResults(results);
      } finally {
        if (activeRequestRef.current === requestId) setIsSearching(false);
      }
    }, 300);
  };

  const addPendingShare = (selectedUser: UserSearchResult, permission: AssignablePlaybookPermission) => {
    setPendingShares((previous) => [
      ...previous,
      { id: `${selectedUser.id}-${permission}`, email: selectedUser.email, permission },
    ]);
    setSearchQuery('');
    setSearchResults([]);
  };

  const submitShares = async () => {
    if (pendingShares.length === 0) return;
    setIsLoading(true);
    try {
      const grouped = new Map<AssignablePlaybookPermission, string[]>();
      for (const share of pendingShares) grouped.set(share.permission, [...(grouped.get(share.permission) ?? []), share.email]);
      for (const [permission, emails] of grouped) await sharePlaybook(playbookId, emails, permission);
      setPendingShares([]);
      await loadShares();
      showSuccess(t('sharing.shared'));
    } catch {
      showError(t('sharing.shareFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const closeDialog = () => {
    setPendingShares([]);
    setSearchQuery('');
    setSearchResults([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && closeDialog()}>
      <DialogContent className="w-[95vw] max-w-2xl p-0 gap-0 max-h-[80vh] flex flex-col">
        <DialogHeader className="p-4 pb-3 border-b">
          <DialogTitle className="text-base pr-8">{t('sharing.title', { name: playbookName })}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            <div className="relative rounded-md border bg-background px-2 py-1 transition focus-within:ring-2 focus-within:ring-ring">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <div className="flex flex-wrap items-center gap-2 pl-8 pr-8">
                {pendingShares.map((share) => (
                  <span key={share.id} className="flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs font-medium">
                    {share.email}
                    <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold bg-primary/10 text-primary">{t(`sharing.permission.${share.permission}`)}</span>
                    <button type="button" onClick={() => setPendingShares((items) => items.filter((item) => item.id !== share.id))}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <input value={searchQuery} onChange={(event) => handleSearchChange(event.target.value)} placeholder={t('sharing.searchUsers')} className="flex-1 min-w-30 border-0 bg-transparent py-2 text-sm placeholder:text-muted-foreground focus:outline-none" />
              </div>
              {isSearching && <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-muted-foreground" />}
              {searchResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-50 mt-1 bg-background border rounded-md shadow-lg max-h-60 overflow-y-auto">
                  {searchResults.map((result) => (
                    <div key={result.id} className="flex items-center justify-between px-3 py-2 hover:bg-muted transition-colors">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{result.firstName || result.lastName ? [result.firstName, result.lastName].filter(Boolean).join(' ') : result.email}</div>
                        <div className="text-xs text-muted-foreground truncate">{result.email}</div>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => addPendingShare(result, 'read')}>{t('sharing.permission.read')}</Button>
                        <Button variant="ghost" size="sm" onClick={() => addPendingShare(result, 'write')}>{t('sharing.permission.write')}</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {pendingShares.length > 0 && <Button onClick={submitShares} disabled={isLoading} className="w-full">{t('sharing.invite')}</Button>}
            <Separator />
            <h3 className="text-sm font-medium">{t('sharing.peopleWithAccess')}</h3>
            <div className="space-y-1">
              <div className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded-md">
                <div className="flex items-center gap-3"><div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-medium">{userInitials}</div><div><div className="text-sm font-medium">{t('sharing.you')}</div><div className="text-xs text-muted-foreground">{t('sharing.ownerDescription')}</div></div></div>
                <span className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground">{t('sharing.permission.owner')}</span>
              </div>
              {shares.map((share) => <ShareRow key={share.shareId} share={share} disabled={isLoading} onUpdate={async (permission) => { setShares((items) => items.map((item) => item.shareId === share.shareId ? { ...item, permission } : item)); await updatePlaybookSharePermission(playbookId, share.shareId, permission); }} onRevoke={async () => { await revokePlaybookShare(playbookId, share.shareId); setShares((items) => items.filter((item) => item.shareId !== share.shareId)); }} />)}
              {shares.length === 0 && !isLoading && <p className="text-sm text-muted-foreground text-center py-4">{t('sharing.noAccess')}</p>}
            </div>
          </div>
        </ScrollArea>
        <DialogFooter className="p-4 pt-3 border-t"><Button variant="outline" onClick={closeDialog} className="w-full">{t('sharing.cancel')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShareRow({ share, disabled, onUpdate, onRevoke }: Readonly<{ share: PlaybookShareEntry; disabled: boolean; onUpdate: (permission: AssignablePlaybookPermission) => void; onRevoke: () => void }>) {
  const { t } = useModuleTranslation('playbook');
  const displayName = share.user.firstName || share.user.lastName ? [share.user.firstName, share.user.lastName].filter(Boolean).join(' ') : share.user.email;
  return (
    <div className="flex items-center justify-between py-2 px-3 hover:bg-muted/50 rounded-md transition-colors">
      <div className="min-w-0"><div className="text-sm font-medium truncate">{displayName}</div><div className="text-xs text-muted-foreground truncate">{share.user.email}</div></div>
      <div className="flex items-center gap-1">
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" disabled={disabled}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => onUpdate('read')} className={cn('cursor-pointer', share.permission === 'read' && 'bg-muted')}>{t('sharing.permission.read')}</DropdownMenuItem><DropdownMenuItem onClick={() => onUpdate('write')} className={cn('cursor-pointer', share.permission === 'write' && 'bg-muted')}>{t('sharing.permission.write')}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={onRevoke} disabled={disabled}><X className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}
