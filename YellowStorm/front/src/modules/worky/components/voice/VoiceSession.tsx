import { useEffect, useRef, type JSX } from 'react';
import { MicOff, PhoneOff, Keyboard } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useModuleTranslation } from '@/modules/localization';
import { useVoiceSession, type VoiceState } from '../../voice/useVoiceSession';
import { VoiceOrb } from './VoiceOrb';

const STATE_LABEL = {
  idle: 'voice.idle',
  listening: 'voice.listening',
  thinking: 'voice.thinking',
  speaking: 'voice.speaking',
} as const satisfies Record<VoiceState, string>;

function ControlButton({
  label,
  onClick,
  variant,
  children,
}: {
  label: string;
  onClick: () => void;
  variant: 'neutral' | 'danger';
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={
        variant === 'danger'
          ? 'flex size-16 items-center justify-center rounded-full bg-destructive text-white'
          : 'flex size-14 items-center justify-center rounded-full border border-border bg-card text-foreground'
      }
    >
      {children}
    </button>
  );
}

/**
 * Immersive turn-based voice session. Opening it starts the loop; End (or
 * closing the sheet) stops it. Chief-of-Staff chat stays hidden — Keyboard
 * switches to the typed composer via the caller.
 */
export function VoiceSession({
  streamId,
  open,
  onOpenChange,
  onKeyboard,
}: {
  streamId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onKeyboard?: () => void;
}): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const { state, transcript, start, stop } = useVoiceSession(streamId);
  const startedRef = useRef(false);

  useEffect(() => {
    if (open && !startedRef.current) {
      startedRef.current = true;
      start();
    } else if (!open && startedRef.current) {
      startedRef.current = false;
      stop();
    }
  }, [open, start, stop]);

  const end = (): void => {
    stop();
    startedRef.current = false;
    onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) end();
      }}
    >
      <SheetContent side="bottom" className="flex h-full flex-col items-center justify-between gap-6 rounded-t-2xl py-10">
        <SheetHeader className="sr-only">
          <SheetTitle>{t('voice.manager')}</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col items-center gap-2 pt-6">
          <span className="text-sm font-semibold text-primary">{t('voice.manager')}</span>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-6">
          <VoiceOrb state={state} />
          <p className="text-xl font-semibold text-foreground">{t(STATE_LABEL[state])}</p>
          {transcript.you || transcript.manager ? (
            <div className="max-w-sm rounded-2xl border border-border bg-card p-4 text-center">
              {transcript.you ? <p className="text-sm text-muted-foreground">{transcript.you}</p> : null}
              {transcript.manager ? <p className="mt-2 text-sm text-foreground">{transcript.manager}</p> : null}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-6">
          <ControlButton label={t('voice.mute')} onClick={stop} variant="neutral">
            <MicOff className="size-5" />
          </ControlButton>
          <ControlButton label={t('voice.end')} onClick={end} variant="danger">
            <PhoneOff className="size-6" />
          </ControlButton>
          <ControlButton
            label={t('voice.keyboard')}
            onClick={() => {
              end();
              onKeyboard?.();
            }}
            variant="neutral"
          >
            <Keyboard className="size-5" />
          </ControlButton>
        </div>
      </SheetContent>
    </Sheet>
  );
}
