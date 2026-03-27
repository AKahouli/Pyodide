import { useState, useCallback } from 'react';
import { X, Check, AlertCircle, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cloneSharePlaybook } from '../api';
import type { CloneShareResult } from '../types';
import { useModuleTranslation } from '@/modules/localization';

interface CloneShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playbookId: string;
}

export function CloneShareDialog({
  open,
  onOpenChange,
  playbookId,
}: CloneShareDialogProps) {
  const { t } = useModuleTranslation('playbook');
  const [emails, setEmails] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isSharing, setIsSharing] = useState(false);
  const [results, setResults] = useState<CloneShareResult | null>(null);

  const addEmail = useCallback(() => {
    const email = inputValue.trim().toLowerCase();
    if (email && email.includes('@') && email.includes('.') && !emails.includes(email)) {
      setEmails((prev) => [...prev, email]);
      setInputValue('');
    }
  }, [inputValue, emails]);

  const removeEmail = useCallback((email: string) => {
    setEmails((prev) => prev.filter((e) => e !== email));
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        addEmail();
      }
    },
    [addEmail],
  );

  const handleShare = useCallback(async () => {
    if (emails.length === 0) return;
    setIsSharing(true);
    setResults(null);
    try {
      const result = await cloneSharePlaybook(playbookId, emails);
      setResults(result);
      if (result.succeeded.length > 0) {
        setEmails([]);
      }
    } catch {
      // handled
    } finally {
      setIsSharing(false);
    }
  }, [playbookId, emails]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setEmails([]);
        setInputValue('');
        setResults(null);
      }
      onOpenChange(open);
    },
    [onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('share.cloneTitle')}</DialogTitle>
          <DialogDescription>{t('share.cloneDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5 rounded-md border p-2 min-h-[40px]">
            {emails.map((email) => (
              <Badge key={email} variant="secondary" className="gap-1">
                {email}
                <button onClick={() => removeEmail(email)} className="ml-0.5 hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={addEmail}
              placeholder={emails.length === 0 ? t('share.emailPlaceholder') : ''}
              className="flex-1 min-w-[150px] border-0 p-0 h-6 shadow-none focus-visible:ring-0"
            />
          </div>

          {results && (
            <div className="space-y-1.5 text-sm">
              {results.succeeded.map((s) => (
                <div key={s.email} className="flex items-center gap-2 text-green-600">
                  <Check className="h-3.5 w-3.5" />
                  <span>{s.email}</span>
                </div>
              ))}
              {results.failed.map((f) => (
                <div key={f.email} className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>{f.email} — {f.reason}</span>
                </div>
              ))}
            </div>
          )}

          <Button onClick={handleShare} disabled={isSharing || emails.length === 0} className="w-full">
            {isSharing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('share.sharing')}
              </>
            ) : (
              t('share.share')
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
