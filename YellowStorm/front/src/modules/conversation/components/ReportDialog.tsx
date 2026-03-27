import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useModuleTranslation } from '@/modules/localization';
import { useConversationStore } from '../store';

const REPORT_REASONS = [
  { value: 'inaccurate', labelKey: 'dialogs.report.reasons.inaccurate' as const },
  { value: 'wrong_information', labelKey: 'dialogs.report.reasons.wrongInformation' as const },
  { value: 'offensive', labelKey: 'dialogs.report.reasons.offensive' as const },
  { value: 'out_of_context', labelKey: 'dialogs.report.reasons.outOfContext' as const },
  { value: 'hallucination', labelKey: 'dialogs.report.reasons.hallucination' as const },
  { value: 'other', labelKey: 'dialogs.report.reasons.other' as const },
] as const;

type ReportReason = (typeof REPORT_REASONS)[number]['value'];

interface ReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  messageId: string;
}

export function ReportDialog({ open, onOpenChange, conversationId, messageId }: ReportDialogProps) {
  const reportMessage = useConversationStore((s) => s.reportMessage);
  const [reason, setReason] = useState<ReportReason | ''>('');
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { t } = useModuleTranslation('conversation');
  const { t: tCommon } = useModuleTranslation('common');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason || !description.trim()) return;

    setIsLoading(true);
    try {
      await reportMessage(conversationId, messageId, {
        reason,
        description: description.trim(),
      });
      onOpenChange(false);
      resetForm();
    } catch {
      // Error handled in store
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setReason('');
    setDescription('');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) resetForm();
      }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('dialogs.report.title')}</DialogTitle>
          <DialogDescription>{t('dialogs.report.description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className='space-y-4'>
          <div className='space-y-2'>
            <label className='text-sm font-medium'>{t('dialogs.report.reasonLabel')}</label>
            <Select value={reason} onValueChange={(v) => setReason(v as ReportReason)}>
              <SelectTrigger>
                <SelectValue placeholder={t('dialogs.report.reasonPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {REPORT_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {t(r.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-2'>
            <label className='text-sm font-medium'>{t('dialogs.report.descriptionLabel')}</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('dialogs.report.descriptionPlaceholder')} maxLength={2000} rows={4} />
            <p className='text-xs text-muted-foreground'>{t('dialogs.report.charCount', { count: description.length, max: 2000 })}</p>
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              {tCommon('actionCancel')}
            </Button>
            <Button type='submit' disabled={isLoading || !reason || !description.trim()}>
              {isLoading ? t('dialogs.report.submitting') : t('dialogs.report.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
