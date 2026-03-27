import { useState } from 'react';
import { Copy, Link, Mail, Plus, X, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useModuleTranslation } from '@/modules/localization';
import { createShare } from '../api';
import type { ShareType, ShareResponse } from '../types';

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  conversationTitle: string;
}

const EXPIRY_OPTIONS = [
  { value: '1', labelKey: 'dialogs.share.expiryOptions.1' as const },
  { value: '7', labelKey: 'dialogs.share.expiryOptions.7' as const },
  { value: '30', labelKey: 'dialogs.share.expiryOptions.30' as const },
  { value: '90', labelKey: 'dialogs.share.expiryOptions.90' as const },
  { value: '365', labelKey: 'dialogs.share.expiryOptions.365' as const },
];

export function ShareDialog({ open, onOpenChange, conversationId, conversationTitle }: ShareDialogProps) {
  const [activeTab, setActiveTab] = useState<ShareType>('public');
  const [title, setTitle] = useState(conversationTitle);
  const [expiresInDays, setExpiresInDays] = useState('30');
  const [emails, setEmails] = useState<string[]>(['']);
  const [isLoading, setIsLoading] = useState(false);
  const [shareResult, setShareResult] = useState<ShareResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const { t } = useModuleTranslation('conversation');
  const { t: tCommon } = useModuleTranslation('common');

  const resetState = () => {
    setTitle(conversationTitle);
    setExpiresInDays('30');
    setEmails(['']);
    setShareResult(null);
    setCopied(false);
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      resetState();
    }
    onOpenChange(isOpen);
  };

  const addEmailField = () => {
    setEmails([...emails, '']);
  };

  const removeEmailField = (index: number) => {
    if (emails.length > 1) {
      setEmails(emails.filter((_, i) => i !== index));
    }
  };

  const updateEmail = (index: number, value: string) => {
    const newEmails = [...emails];
    newEmails[index] = value;
    setEmails(newEmails);
  };

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
              recipientEmails: emails.filter((e) => e.trim()),
            };

      const result = await createShare(conversationId, payload);
      setShareResult(result);

      if (activeTab === 'public') {
        toast.success(t('toasts.share.linkCreated'));
      } else {
        toast.success(t('toasts.share.sharedWith', { count: payload.recipientEmails?.length ?? 0 }));
      }
    } catch {
      toast.error(t('toasts.share.error'));
    } finally {
      setIsLoading(false);
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

  const validEmails = emails.filter((e) => e.trim() && e.includes('@'));
  const canSharePrivate = validEmails.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{t('dialogs.share.title')}</DialogTitle>
          <DialogDescription>{t('dialogs.share.description')}</DialogDescription>
        </DialogHeader>

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
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>{tCommon('actionClose')}</Button>
            </DialogFooter>
          </div>
        ) : (
          // Show share form
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ShareType)}>
            <TabsList className='grid w-full grid-cols-2'>
              <TabsTrigger value='public' className='gap-2'>
                <Link className='h-4 w-4' />
                {t('dialogs.share.tabs.public')}
              </TabsTrigger>
              <TabsTrigger value='private' className='gap-2' disabled>
                <Mail className='h-4 w-4' />
                {t('dialogs.share.tabs.private')}
              </TabsTrigger>
            </TabsList>

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
                  <Label>{t('dialogs.share.form.recipientLabel')}</Label>
                  {emails.map((email, index) => (
                    <div key={index} className='flex gap-2'>
                      <Input type='email' value={email} onChange={(e) => updateEmail(index, e.target.value)} placeholder={t('dialogs.share.form.recipientPlaceholder')} />
                      {emails.length > 1 && (
                        <Button type='button' variant='ghost' size='icon' onClick={() => removeEmailField(index)}>
                          <X className='h-4 w-4' />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button type='button' variant='outline' size='sm' onClick={addEmailField} className='w-full'>
                    <Plus className='h-4 w-4 mr-2' />
                    {t('dialogs.share.form.addEmail')}
                  </Button>
                </div>
              </TabsContent>
            </div>

            <DialogFooter className='mt-4'>
              <Button variant='outline' onClick={() => handleOpenChange(false)}>
                {tCommon('actionCancel')}
              </Button>
              <Button onClick={handleShare} disabled={isLoading || (activeTab === 'private' && !canSharePrivate)}>
                {isLoading ? (
                  <>
                    <Loader2 className='mr-2 h-4 w-4 animate-spin' />
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
      </DialogContent>
    </Dialog>
  );
}
