import { useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { showError } from '@/lib/notifications';
import { useCreateStream } from '../query/hooks';
import { WORKY_STREAM_TITLE_MAX, WORKY_STREAM_TITLE_MIN } from '../constants';

/**
 * Stream-creation dialog, shared by the landing dashboard and the stream
 * top bar so a new stream can be started without navigating home first.
 * Navigates to the new stream on success.
 */
export function NewStreamDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const navigate = useNavigate();
  const [draftTitle, setDraftTitle] = useState('');
  const createStream = useCreateStream();

  const titleLength = draftTitle.trim().length;
  const canCreate =
    !createStream.isPending &&
    titleLength >= WORKY_STREAM_TITLE_MIN &&
    titleLength <= WORKY_STREAM_TITLE_MAX;

  const close = (): void => {
    onOpenChange(false);
    setDraftTitle('');
  };

  const onCreate = async (): Promise<void> => {
    if (!canCreate) return;
    try {
      const stream = await createStream.mutateAsync({ title: draftTitle.trim() });
      close();
      navigate(`/worky/${stream.id}`);
    } catch (error) {
      showError(error instanceof Error ? error.message : t('dashboard.createFailed'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('dashboard.newStream')}</DialogTitle>
          <DialogDescription>{t('dashboard.newStreamDescription')}</DialogDescription>
        </DialogHeader>
        <Input
          id="worky-new-stream-title"
          name="streamTitle"
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          placeholder={t('dashboard.newStreamPlaceholder')}
          maxLength={WORKY_STREAM_TITLE_MAX}
          disabled={createStream.isPending}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void onCreate();
            }
          }}
          autoFocus
        />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close} disabled={createStream.isPending}>
            {t('actions.cancel')}
          </Button>
          <Button type="button" onClick={() => void onCreate()} disabled={!canCreate}>
            {createStream.isPending ? <Loader2 className="size-4 animate-spin" /> : t('actions.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
