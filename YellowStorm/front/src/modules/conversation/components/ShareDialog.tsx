import { useEffect, useState } from 'react';
import { Copy, Link, Mail, X, Loader2, Check, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useModuleTranslation } from '@/modules/localization';
import { useAuth } from '@/modules/auth';
import { createShare, getShares, revokeShare, revokeShareRecipient, searchShareRecipients } from '../api';
import { useConversationStore } from '../store';
import type { ShareType, ShareResponse } from '../types';

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  conversationTitle: string;
  governed?: boolean;
}

const EXPIRY_OPTIONS = [
  { value: '1', labelKey: 'dialogs.share.expiryOptions.1' as const },
  { value: '7', labelKey: 'dialogs.share.expiryOptions.7' as const },
  { value: '30', labelKey: 'dialogs.share.expiryOptions.30' as const },
  { value: '90', labelKey: 'dialogs.share.expiryOptions.90' as const },
  { value: '365', labelKey: 'dialogs.share.expiryOptions.365' as const },
];

type Recipient = { id: string; email: string; firstName?: string; lastName?: string };

export function ShareDialog({ open, onOpenChange, conversationId, conversationTitle, governed = false }: ShareDialogProps) {
  const [activeTab, setActiveTab] = useState<ShareType>('private');
  const [title, setTitle] = useState(conversationTitle);
  const [expiresInDays, setExpiresInDays] = useState('30');
  const [selected, setSelected] = useState<Recipient[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Recipient[]>([]);
  const [shares, setShares] = useState<ShareResponse[]>([]);
  const [searching, setSearching] = useState(false);
  const [shareWorkspaces, setShareWorkspaces] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [shareResult, setShareResult] = useState<ShareResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const refreshCurrentConversation = useConversationStore((s) => s.refreshCurrentConversation);
  const fetchConversations = useConversationStore((s) => s.fetchConversations);
  const { t } = useModuleTranslation('conversation');
  const { t: tCommon } = useModuleTranslation('common');
  const { user } = useAuth();

  const resetState = () => {
    setTitle(conversationTitle);
    setExpiresInDays('30');
    setSelected([]);
    setQuery('');
    setResults([]);
    setShareWorkspaces(false);
    setShareResult(null);
    setCopied(false);
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      resetState();
    }
    onOpenChange(isOpen);
  };

  useEffect(() => {
    if (!open) return;
    setActiveTab('private');
    getShares(conversationId).then(setShares).catch(() => toast.error(t('toasts.share.error')));
  }, [open, governed, conversationId]);

  useEffect(() => {
    if (!open || query.trim().length < 3) { setResults([]); setSearching(false); return; }
    let cancelled = false;
    setResults([]);
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const users = await searchShareRecipients(conversationId, query.trim());
        if (!cancelled) setResults(users);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, conversationId, query]);

  const handleShare = async () => {
    setIsLoading(true);
    try {
      const payload =
        activeTab === 'public'
          ? {
              shareType: 'public' as const,
              title: title.trim() || undefined,
              expiresInDays: parseInt(expiresInDays),
            }
          : {
              shareType: 'private' as const,
              title: title.trim() || undefined,
              recipientEmails: selected.map((user) => user.email),
              ...(!governed ? { shareWorkspaces } : {}),
            };

      const result = await createShare(conversationId, payload);
      setShareResult(result);
      void getShares(conversationId).then(setShares).catch(() => toast.error(t('toasts.share.error')));
      setSelected([]);

      // Sharing changes membership/link state, so the derived "shared" flag and
      // member list must be refreshed or the header badge and manage action go stale.
      await refreshCurrentConversation(conversationId);
      void fetchConversations({ reset: true });

      if (activeTab === 'public') {
        toast.success(t('toasts.share.linkCreated'));
      } else {
        toast.success(t('toasts.share.sharedWith', { count: result.recipientEmails?.length ?? 0 }));
      }
    } catch {
      toast.error(t('toasts.share.error'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRevoke = async (shareId: string, recipientId?: string) => {
    try {
      if (recipientId) await revokeShareRecipient(conversationId, shareId, recipientId);
      else await revokeShare(conversationId, shareId);
      setShares(await getShares(conversationId));
      await refreshCurrentConversation(conversationId);
      void fetchConversations({ reset: true });
    } catch {
      toast.error(t('toasts.share.error'));
    }
  };

  const getShareUrl = () => {
    if (!shareResult?.accessToken) return '';
    return `${window.location.origin}/#/share/${shareResult.accessToken}`;
  };

  const copyToClipboard = async () => {
    const url = getShareUrl();
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success(t('toasts.linkCopied'));
    setTimeout(() => setCopied(false), 2000);
  };

  const canSharePrivate = selected.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='w-[95vw] max-w-2xl max-h-[80vh] flex flex-col p-0 gap-0'>
        <DialogHeader className='p-4 pb-3 border-b'>
          <DialogTitle>{t('dialogs.share.title')}</DialogTitle>
          <DialogDescription>{t(governed ? 'dialogs.share.governedDescription' : 'dialogs.share.description')}</DialogDescription>
        </DialogHeader>

        <ScrollArea className='flex-1'><div className='p-4 space-y-4'>

        {shareResult && activeTab === 'public' ? (
          // Show share link result
          <div className='space-y-4'>
            <Label>{t('dialogs.share.linkLabel')}</Label>
            <div className='flex gap-2'>
              <Input value={getShareUrl()} readOnly className='font-mono text-sm' />
              <Button onClick={copyToClipboard} variant='outline' size='icon'>
                {copied ? <Check className='h-4 w-4' /> : <Copy className='h-4 w-4' />}
              </Button>
            </div>
            <p className='text-sm text-muted-foreground'>{t('dialogs.share.linkExpires', { date: new Date(shareResult.expiresAt!).toLocaleDateString() })}</p>
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>{tCommon('actionClose')}</Button>
            </DialogFooter>
          </div>
        ) : shareResult && activeTab === 'private' ? (
          // Show private share result
          <div className='space-y-4'>
            <p className='text-sm text-muted-foreground'>{t('dialogs.share.privateResult', { count: shareResult.recipientEmails?.length ?? 0 })}</p>
            {(shareResult.sharedWorkspaceCount ?? 0) > 0 && (
              <p className='text-sm text-muted-foreground'>
                {t('dialogs.share.workspaceResult', { count: shareResult.sharedWorkspaceCount })}
              </p>
            )}
            {(shareResult.notFound?.length ?? 0) > 0 && (
              <p className='text-sm text-destructive'>
                {t('dialogs.share.notFound', { emails: shareResult.notFound?.join(', ') })}
              </p>
            )}
            {(shareResult.invalid?.length ?? 0) > 0 && (
              <p className='text-sm text-destructive'>
                {t('dialogs.share.invalid', { emails: shareResult.invalid?.join(', ') })}
              </p>
            )}
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>{tCommon('actionClose')}</Button>
            </DialogFooter>
          </div>
        ) : (
          // Show share form
          <Tabs value={governed ? 'private' : activeTab} onValueChange={(v) => setActiveTab(v as ShareType)}>
            {!governed &&
            <TabsList className='grid w-full grid-cols-2'>
              <TabsTrigger value='public' className='gap-2'>
                <Link className='h-4 w-4' />
                {t('dialogs.share.tabs.public')}
              </TabsTrigger>
              <TabsTrigger value='private' className='gap-2'>
                <Mail className='h-4 w-4' />
                {t('dialogs.share.tabs.private')}
              </TabsTrigger>
            </TabsList>}

            <div className='mt-4 space-y-4'>
              {/* Title field (both modes) */}
              <div className='space-y-2'>
                <Label htmlFor='title'>{t('dialogs.share.form.titleLabel')}</Label>
                <Input id='title' value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('dialogs.share.form.titlePlaceholder')} maxLength={200} />
              </div>

              <TabsContent value='public' className='space-y-4 mt-0'>
                <div className='space-y-2'>
                  <Label>{t('dialogs.share.form.expirationLabel')}</Label>
                  <Select value={expiresInDays} onValueChange={setExpiresInDays}>
                    <SelectTrigger>
                      <SelectValue placeholder={t('dialogs.share.form.expirationPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPIRY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {t(opt.labelKey)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </TabsContent>

              <TabsContent value='private' className='space-y-4 mt-0'>
                <div className='space-y-2'>
                  <Label htmlFor='conversation-share-search'>{t('dialogs.share.form.recipientLabel')}</Label>
                  <div className='relative rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring'>
                    <Search className='absolute left-3 top-3 h-4 w-4 text-muted-foreground' aria-hidden='true' />
                    <div className='flex flex-wrap gap-2 ps-9 pe-3'>
                      {selected.map((user) => <span key={user.id} className='my-1 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs'>{user.email}<button type='button' aria-label={`${t('dialogs.share.removeRecipient')} ${user.email}`} onClick={() => setSelected(selected.filter((item) => item.id !== user.id))}><X className='size-3' /></button></span>)}
                      <input id='conversation-share-search' value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('dialogs.share.form.searchPlaceholder')} className='min-w-36 flex-1 border-0 bg-transparent py-2 text-sm outline-none' />
                    </div>
                    {searching && <Loader2 className='absolute right-3 top-3 size-4 animate-spin' />}
                  </div>
                  {query.trim().length >= 3 && !searching && <div className='max-h-48 overflow-y-auto rounded-md border'>
                    {results.filter((user) => !selected.some((item) => item.id === user.id)).map((user) => <button key={user.id} type='button' className='flex w-full items-center gap-3 px-3 py-2 text-start hover:bg-muted focus-visible:bg-muted' onClick={() => { setSelected([...selected, user]); setQuery(''); }}><span className='flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary'>{(user.firstName || user.email)[0]?.toUpperCase()}</span><span className='min-w-0'><span className='block truncate text-sm font-medium'>{[user.firstName, user.lastName].filter(Boolean).join(' ') || user.email}</span><span className='block truncate text-xs text-muted-foreground'>{user.email}</span></span></button>)}
                    {results.length === 0 && <p className='p-3 text-sm text-muted-foreground'>{t('dialogs.share.noResults')}</p>}
                  </div>}
                </div>
                {!governed &&
                <div className='flex items-start gap-2 rounded-md border p-3'>
                  <Checkbox
                    id='share-conversation-workspaces'
                    checked={shareWorkspaces}
                    onCheckedChange={(checked) => setShareWorkspaces(checked === true)}
                  />
                  <Label htmlFor='share-conversation-workspaces' className='cursor-pointer text-sm leading-5'>
                    {t('dialogs.share.form.shareWorkspaces')}
                  </Label>
                </div>}
              </TabsContent>
            </div>

            <DialogFooter className='mt-4'>
              <Button variant='outline' onClick={() => handleOpenChange(false)}>
                {tCommon('actionCancel')}
              </Button>
              <Button onClick={handleShare} disabled={isLoading || (activeTab === 'private' && !canSharePrivate)}>
                {isLoading ? (
                  <>
                    <Loader2 className='me-2 h-4 w-4 animate-spin' />
                    {t('dialogs.share.actions.sharing')}
                  </>
                ) : activeTab === 'public' ? (
                  t('dialogs.share.actions.generateLink')
                ) : (
                  t('dialogs.share.actions.share')
                )}
              </Button>
            </DialogFooter>
          </Tabs>
        )}
        <Separator />
        <div className='space-y-2'>
          <h3 className='text-sm font-medium'>{t('dialogs.share.peopleWithAccess')}</h3>
          <div className='flex items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2'><div className='flex min-w-0 items-center gap-3'><span className='flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-sm text-primary'>{user?.email?.[0]?.toUpperCase() ?? 'Y'}</span><div className='min-w-0'><p className='text-sm font-medium'>{t('dialogs.share.you')}</p><p className='truncate text-xs text-muted-foreground'>{user?.email}</p></div></div><span className='rounded bg-muted px-2 py-1 text-xs text-muted-foreground'>{t('dialogs.share.owner')}</span></div>
          {shares.filter((share) => !share.isRevoked && share.shareType === 'private').flatMap((share) =>
            share.recipientUserIds?.length === share.recipientEmails?.length
              ? (share.recipientEmails ?? []).map((email, index) => ({ share, email, recipientId: share.recipientUserIds?.[index] }))
              : [{ share, email: (share.recipientEmails ?? []).join(', '), recipientId: undefined }],
          ).map(({ share, email, recipientId }) => <div key={`${share.id}-${email}`} className='flex items-center justify-between gap-2 rounded-md px-3 py-2 hover:bg-muted/50'><div className='min-w-0'><p className='truncate text-sm'>{email}</p><p className='text-xs text-muted-foreground'>{t('dialogs.share.access')}</p></div><Button type='button' variant='ghost' size='icon' aria-label={`${t('dialogs.share.revoke')} ${email}`} onClick={() => void handleRevoke(share.id, recipientId)}><X className='size-4 text-destructive' /></Button></div>)}
          {!shares.some((share) => !share.isRevoked && share.shareType === 'private') && <p className='py-3 text-center text-sm text-muted-foreground'>{t('dialogs.share.noAccess')}</p>}
        </div>
        </div></ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
