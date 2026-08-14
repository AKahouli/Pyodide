import { useEffect, useState, type JSX } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { getVoicePrompt, setVoicePrompt } from '../../api';

/**
 * Per-stream concierge prompt editor. Loads the stream's prompt (or the default)
 * on open; Save persists it, Reset (blank save) restores the default. Applies on
 * the next voice session start.
 */
export function ConciergeInstructionsDialog({
  streamId,
  open,
  onOpenChange,
}: {
  streamId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const [text, setText] = useState('');
  const [isDefault, setIsDefault] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !streamId) return;
    let cancelled = false;
    void getVoicePrompt(streamId)
      .then((r) => {
        if (cancelled) return;
        setText(r.prompt);
        setIsDefault(r.isDefault);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, streamId]);

  const save = async (value: string): Promise<void> => {
    setSaving(true);
    try {
      const r = await setVoicePrompt(streamId, value);
      setText(r.prompt);
      setIsDefault(r.isDefault);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('voicePrompt.title')}</DialogTitle>
          <DialogDescription>{t('voicePrompt.description')}</DialogDescription>
        </DialogHeader>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} className="min-h-48" />
        {isDefault ? <p className="text-xs text-muted-foreground">{t('voicePrompt.default')}</p> : null}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={saving} onClick={() => void save('')}>
            {t('voicePrompt.reset')}
          </Button>
          <Button type="button" disabled={saving} onClick={() => void save(text)}>
            {t('voicePrompt.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
