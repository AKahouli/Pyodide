import { Loader2, MessageCircle, Mic, Send, Square } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group';
import { useModuleTranslation } from '@/modules/localization';
import { useSendMessage, useTranscribeAudio } from '../query/hooks';
import { useWorkyStore, useWorkyStreaming } from '../store';
import { useWorkyUiStore } from '../uiStore';
import { useAudioRecorder, type RecordingResult } from '../useAudioRecorder';
import type { WorkyStreamStatus } from '../types';

interface PromptBarProps {
  streamId: string;
  status?: WorkyStreamStatus;
  onWhatsAppClick?: () => void;
  whatsappConnected?: boolean;
}

/**
 * Composer-only prompt input. Model/prompt selection is intentionally not
 * exposed here: the planner and executor are admin-created default agents
 * (resolved server-side by agent type), so there is no per-stream or per-turn
 * model override to configure.
 */
export function PromptBar({
  streamId,
  status,
  onWhatsAppClick,
  whatsappConnected,
}: PromptBarProps): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const [value, setValue] = useState('');
  const send = useSendMessage(streamId);
  const streaming = useWorkyStreaming();
  const setStreamError = useWorkyStore((s) => s.setStreamError);
  const setStreaming = useWorkyStore((s) => s.setStreaming);
  const notifySendError = useWorkyUiStore((s) => s.notifySendError);
  const clearSendError = useWorkyUiStore((s) => s.clearSendError);
  const sendError = useWorkyUiStore((s) => s.sendError);
  const transcribe = useTranscribeAudio();

  // Shared finalizer for both manual stop and silence auto-stop: skip silent
  // clips (Whisper hallucinates on them) and otherwise append the transcript
  // to the current draft so the owner can edit before sending.
  const transcribeResult = useCallback(
    async ({ blob, hadSpeech }: RecordingResult) => {
      if (!blob) return;
      if (!hadSpeech) {
        notifySendError(t('promptBar.voice.empty'));
        return;
      }
      try {
        const { text } = await transcribe.mutateAsync({ blob });
        const trimmed = text.trim();
        if (trimmed) {
          setValue((prev) => (prev ? `${prev.trim()} ${trimmed}` : trimmed));
        } else {
          notifySendError(t('promptBar.voice.empty'));
        }
      } catch {
        notifySendError(t('promptBar.voice.failed'));
      }
    },
    [transcribe, notifySendError, t],
  );

  // Hands-free dictation: the recorder auto-stops ~2.5s after the speaker goes
  // quiet — but only once they've actually started, so long lead-ins and
  // mid-sentence breaths/pauses are preserved. Manual tap ends the take early.
  const recorder = useAudioRecorder({ onAutoStop: transcribeResult, silenceTimeoutMs: 1500 });
  const isDisabled = send.isPending || status === 'archived';
  const isTranscribing = transcribe.isPending;

  // Reset the draft and any in-flight error on stream switch so the
  // composer never carries text or stale failure toasts across streams.
  useEffect(() => {
    setValue('');
    clearSendError();
    if (recorder.isRecording) recorder.cancel();
  }, [streamId, clearSendError]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tap to start dictating; tap again to cut the take short (auto-stop on
  // silence handles the common case via `transcribeResult`).
  const toggleMic = async () => {
    clearSendError();
    if (recorder.isRecording) {
      const result = await recorder.stop();
      await transcribeResult(result);
      return;
    }
    await recorder.start();
  };

  // `start()` sets `error` asynchronously, so surface mic failures here rather
  // than inline after the call (where the value would still be stale).
  useEffect(() => {
    if (recorder.error === 'permission') notifySendError(t('promptBar.voice.denied'));
    else if (recorder.error === 'unsupported')
      notifySendError(t('promptBar.voice.unsupported'));
  }, [recorder.error]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const content = value.trim();
    if (!content || isDisabled) return;
    setStreamError(null);
    clearSendError();
    setStreaming(true);
    send.mutate(
      { content },
      {
        onSuccess: () => setValue(''),
        onError: (err: unknown) => {
          setStreaming(false);
          const message =
            (err as { message?: string })?.message ?? t('promptBar.sendFailed');
          notifySendError(message);
        },
      },
    );
  };

  return (
    <div className='flex flex-col gap-1'>
      {sendError ? (
        <div
          role='alert'
          data-testid='worky-send-error'
          className='flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive'
        >
          <span className='flex-1 break-words'>{sendError}</span>
          <button
            type='button'
            className='text-destructive/80 underline-offset-2 hover:underline'
            onClick={clearSendError}
          >
            {t('stream.errorDismiss')}
          </button>
        </div>
      ) : null}
      <form onSubmit={submit}>
        <InputGroup className='bg-background/60'>
          <InputGroupTextarea
            id='worky-prompt-content'
            name='content'
            data-testid='worky-prompt-content'
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={t('promptBar.placeholder')}
            rows={1}
            disabled={isDisabled}
            className='max-h-40 min-h-[44px] py-2 text-xs'
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(e);
              }
            }}
          />
          <InputGroupAddon align='block-end' className='justify-end gap-1'>
            {onWhatsAppClick ? (
              <InputGroupButton
                type='button'
                size='icon-sm'
                variant='ghost'
                onClick={onWhatsAppClick}
                disabled={isDisabled}
                aria-label={t('whatsapp.openModal')}
                data-testid='worky-prompt-whatsapp'
                className='relative'
              >
                <MessageCircle className='h-4 w-4' />
                {whatsappConnected ? (
                  <span
                    className='absolute right-1 top-1 h-2 w-2 rounded-full bg-green-500'
                    data-testid='worky-prompt-whatsapp-connected'
                  />
                ) : null}
              </InputGroupButton>
            ) : null}
            {recorder.isSupported ? (
              <InputGroupButton
                type='button'
                size='icon-sm'
                variant={recorder.isRecording ? 'destructive' : 'ghost'}
                onClick={toggleMic}
                disabled={isDisabled || isTranscribing}
                aria-pressed={recorder.isRecording}
                aria-label={
                  isTranscribing
                    ? t('promptBar.voice.transcribing')
                    : recorder.isRecording
                      ? t('promptBar.voice.stop')
                      : t('promptBar.voice.start')
                }
                data-testid='worky-prompt-mic'
              >
                {isTranscribing ? (
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : (
                  <Mic className={recorder.isRecording ? 'h-4 w-4 animate-pulse' : 'h-4 w-4'} />
                )}
              </InputGroupButton>
            ) : null}
            <InputGroupButton
              type='submit'
              size='icon-sm'
              variant='default'
              disabled={isDisabled || !value.trim()}
              aria-label={streaming ? t('promptBar.streaming') : t('promptBar.send')}
              data-testid='worky-prompt-send'
            >
              {streaming ? <Square className='h-4 w-4' /> : <Send className='h-4 w-4' />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </div>
  );
}
