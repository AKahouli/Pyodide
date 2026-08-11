import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { Mic, MicOff, PhoneOff, Keyboard, Check, X, Settings2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { useVoiceSession, type VoiceState } from '../../voice/useVoiceSession';
import { useRealtimeVoiceSession } from '../../voice/useRealtimeVoiceSession';
import { useVoiceSettings } from '../../voice/voiceSettings';
import { VoiceOrb } from './VoiceOrb';
import { VoiceSettingsSheet } from './VoiceSettingsSheet';

const STATE_LABEL = {
  idle: 'voice.idle',
  listening: 'voice.listening',
  thinking: 'voice.thinking',
  speaking: 'voice.speaking',
} as const satisfies Record<VoiceState, string>;

function ControlButton({
  label,
  onClick,
  variant = 'neutral',
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  variant?: 'neutral' | 'danger' | 'primary';
  disabled?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center justify-center rounded-full transition-colors disabled:opacity-40',
        variant === 'danger' && 'size-16 bg-destructive text-white',
        variant === 'primary' && 'size-16 bg-primary text-primary-foreground',
        variant === 'neutral' && 'size-14 border border-border bg-card text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Immersive turn-based voice session. Opening it starts the loop; End (or
 * closing the sheet) stops it.
 *
 * Controls adapt to the turn mode: in `auto` the mic is always live and "Done"
 * cuts the current take short; in `manual` (push-to-talk) the big centre button
 * opens and closes each take explicitly.
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
  const realtimeVoice = useVoiceSettings((s) => s.realtimeVoice);
  const [fellBack, setFellBack] = useState(false);
  const useRealtime = realtimeVoice && !fellBack;

  // Both hooks are instantiated (Rules of Hooks); only the active one is
  // started. The inactive one is passed an empty streamId so it stays inert.
  const realtime = useRealtimeVoiceSession(useRealtime ? streamId : '');
  const legacy = useVoiceSession(useRealtime ? '' : streamId);
  const session = useRealtime ? realtime : legacy;

  const { state, transcript, level, muted, error, toggleMute, submitTurn, cancelTurn, beginTake } = session;
  const turnMode = useVoiceSettings((s) => s.turnMode);
  const threshold = useVoiceSettings((s) => s.speechThreshold);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // If the realtime session errors, fall back to the legacy STT/TTS pipeline.
  useEffect(() => {
    if (realtimeVoice && realtime.error && !fellBack) setFellBack(true);
  }, [realtimeVoice, realtime.error, fellBack]);

  // Start/stop the ACTIVE session with the sheet. Capturing start/stop at
  // effect-run time means an implementation switch (fallback) stops the old
  // session in cleanup and starts the new one on re-run.
  const startRef = useRef(session.start);
  const stopRef = useRef(session.stop);
  startRef.current = session.start;
  stopRef.current = session.stop;

  useEffect(() => {
    if (!open) return undefined;
    const startNow = startRef.current;
    const stopThis = stopRef.current;
    startNow();
    return () => stopThis();
  }, [open, useRealtime]);

  const end = (): void => {
    onOpenChange(false);
  };

  const recording = state === 'listening';
  const meterPct = Math.min(100, (level / Math.max(threshold * 3, 0.001)) * 100);

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) end();
        }}
      >
        <SheetContent
          side="bottom"
          className="flex h-full flex-col items-center justify-between gap-6 rounded-t-2xl py-10"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{t('voice.manager')}</SheetTitle>
          </SheetHeader>

          <div className="flex w-full items-center justify-between px-6 pt-2">
            <span className="text-sm font-semibold text-primary">{t('voice.manager')}</span>
            <button
              type="button"
              aria-label={t('voiceSettings.title')}
              title={t('voiceSettings.title')}
              onClick={() => setSettingsOpen(true)}
              data-testid="voice-settings-open"
              className="flex size-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground"
            >
              <Settings2 className="size-4" />
            </button>
          </div>

          <div className="flex flex-1 flex-col items-center justify-center gap-6">
            <VoiceOrb state={state} />
            <p className="text-xl font-semibold text-foreground">
              {muted ? t('voice.muted') : t(STATE_LABEL[state])}
            </p>

            {/* Live input level — confirms the mic is actually hearing you. */}
            <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted" data-testid="voice-level">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-75"
                style={{ width: recording ? `${meterPct}%` : '0%' }}
              />
            </div>

            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {t(error === 'replyTimeout' ? 'voice.error.timeout' : 'voice.error.send')}
              </p>
            ) : null}

            {transcript.you || transcript.manager ? (
              <div className="max-w-sm rounded-2xl border border-border bg-card p-4 text-center">
                {transcript.you ? <p className="text-sm text-muted-foreground">{transcript.you}</p> : null}
                {transcript.manager ? (
                  <p className="mt-2 text-sm text-foreground">{transcript.manager}</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-4">
            <ControlButton
              label={muted ? t('voice.unmute') : t('voice.mute')}
              onClick={toggleMute}
            >
              {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
            </ControlButton>

            {/* Turn controls only apply to the legacy record-then-reply loop.
                In realtime mode Gemini's own VAD decides when to speak, so we
                hide the Cancel/Done/push-to-talk buttons entirely. */}
            {!useRealtime && recording ? (
              <ControlButton label={t('voice.cancelTurn')} onClick={cancelTurn}>
                <X className="size-5" />
              </ControlButton>
            ) : null}

            {!useRealtime &&
              (turnMode === 'manual' && !recording ? (
                <ControlButton
                  label={t('voice.talk')}
                  onClick={beginTake}
                  variant="primary"
                  disabled={muted}
                >
                  <Mic className="size-6" />
                </ControlButton>
              ) : (
                <ControlButton
                  label={t('voice.done')}
                  onClick={submitTurn}
                  variant="primary"
                  disabled={!recording}
                >
                  <Check className="size-6" />
                </ControlButton>
              ))}

            <ControlButton label={t('voice.end')} onClick={end} variant="danger">
              <PhoneOff className="size-6" />
            </ControlButton>

            <ControlButton
              label={t('voice.keyboard')}
              onClick={() => {
                end();
                onKeyboard?.();
              }}
            >
              <Keyboard className="size-5" />
            </ControlButton>
          </div>
        </SheetContent>
      </Sheet>

      <VoiceSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} level={level} />
    </>
  );
}
