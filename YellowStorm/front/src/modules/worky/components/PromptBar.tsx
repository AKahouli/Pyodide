import { Loader2, MessageCircle, Send, Square } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group';
import { useModuleTranslation } from '@/modules/localization';
import { useSendMessage } from '../query/hooks';
import { useStopSession } from '../hooks/useStopSession';
import { useWorkyStore, useWorkyStreaming } from '../store';
import { useWorkyUiStore } from '../uiStore';
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
 *
 * Voice input lives in the centre voice dock (the realtime concierge), so the
 * old in-composer dictation mic was removed — the send button doubles as a
 * stop control while a run is streaming.
 */
export function PromptBar({
  streamId,
  status,
  onWhatsAppClick,
  whatsappConnected,
}: PromptBarProps): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const send = useSendMessage(streamId);
  const streaming = useWorkyStreaming();
  const setStreamError = useWorkyStore((s) => s.setStreamError);
  const setStreaming = useWorkyStore((s) => s.setStreaming);
  const notifySendError = useWorkyUiStore((s) => s.notifySendError);
  const clearSendError = useWorkyUiStore((s) => s.clearSendError);
  const sendError = useWorkyUiStore((s) => s.sendError);
  const { stop, isStopping } = useStopSession(streamId);

  const isDisabled = send.isPending || status === 'archived';

  // Grow the composer to fit its content, but cap it at 40% of the chat
  // sidebar's height (falling back to 40vh when the composer is not inside the
  // desktop rail, e.g. the mobile sheet). Past that the height is fixed and the
  // textarea scrolls instead of pushing the message thread off-screen.
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const sidebar = el.closest<HTMLElement>('[data-testid="worky-chat-sidebar"]');
    const maxHeight = Math.round(
      (sidebar?.clientHeight ?? window.innerHeight) * 0.4,
    );
    // Reset first so shrinking (deleting text) is measured correctly.
    el.style.height = 'auto';
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);

  useLayoutEffect(() => {
    autoResize();
  }, [value, autoResize]);

  // The 40% cap is derived from the sidebar height, so recompute on viewport
  // resize (which is what changes the sidebar's height).
  useEffect(() => {
    window.addEventListener('resize', autoResize);
    return () => window.removeEventListener('resize', autoResize);
  }, [autoResize]);

  // Reset the draft and any in-flight error on stream switch so the
  // composer never carries text or stale failure toasts across streams.
  useEffect(() => {
    setValue('');
    clearSendError();
  }, [streamId, clearSendError]); // eslint-disable-line react-hooks/exhaustive-deps

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
            ref={textareaRef}
            id='worky-prompt-content'
            name='content'
            data-testid='worky-prompt-content'
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={t('promptBar.placeholder')}
            rows={1}
            disabled={isDisabled}
            // flex-none: the block-end addon makes InputGroup a column flex
            // container, and the inherited `flex-1` (flex-basis:0%) would
            // otherwise override our inline height and keep the box collapsed.
            className='flex-none min-h-[44px] py-2 text-xs'
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
            {streaming ? (
              // While a run streams, the primary button stops the whole run
              // (terminal StopSession) instead of submitting an empty draft.
              <InputGroupButton
                type='button'
                size='icon-sm'
                variant='default'
                onClick={stop}
                disabled={isStopping}
                aria-label={t('promptBar.stop')}
                title={t('promptBar.stop')}
                data-testid='worky-prompt-stop'
              >
                {isStopping ? (
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : (
                  <Square className='h-4 w-4' />
                )}
              </InputGroupButton>
            ) : (
              <InputGroupButton
                type='submit'
                size='icon-sm'
                variant='default'
                disabled={isDisabled || !value.trim()}
                aria-label={t('promptBar.send')}
                data-testid='worky-prompt-send'
              >
                <Send className='h-4 w-4' />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </form>
    </div>
  );
}
