import { MessageCircle, Send } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useModuleTranslation } from '@/modules/localization';
import { useSendMessage } from '../query/hooks';
import { useWorkyStore } from '../store';
import { useWorkyUiStore } from '../uiStore';
import type { WorkyStreamStatus } from '../types';

interface PromptBarProps {
  streamId: string;
  status?: WorkyStreamStatus;
  sessionStatus?: string | null;
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
 * old in-composer dictation mic was removed.
 */
export function PromptBar({
  streamId,
  status,
  sessionStatus,
  onWhatsAppClick,
  whatsappConnected,
}: PromptBarProps): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const send = useSendMessage(streamId);
  const setStreamError = useWorkyStore((s) => s.setStreamError);
  const beginTurn = useWorkyStore((s) => s.beginTurn);
  const finishTurn = useWorkyStore((s) => s.finishTurn);
  const notifySendError = useWorkyUiStore((s) => s.notifySendError);
  const clearSendError = useWorkyUiStore((s) => s.clearSendError);
  const sendError = useWorkyUiStore((s) => s.sendError);
  const isDisabled = send.isPending || status === 'archived' || sessionStatus === 'paused';

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
    const turnId = crypto.randomUUID();
    beginTurn(turnId);
    send.mutate(
      { content, turnId },
      {
        onSuccess: () => setValue(''),
        onError: (err: unknown) => {
          finishTurn(turnId);
          const message =
            (err as { message?: string })?.message ?? t('promptBar.sendFailed');
          notifySendError(message);
        },
      },
    );
  };

  return (
    <footer className='shrink-0 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]'>
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
        <div className='flex items-end gap-2 rounded-xl border bg-card p-2 shadow-sm focus-within:ring-1 focus-within:ring-ring'>
          <Textarea
            ref={textareaRef}
            id='worky-prompt-content'
            name='content'
            data-testid='worky-prompt-content'
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={t('promptBar.placeholder')}
            rows={1}
            disabled={isDisabled}
            className='max-h-none min-h-10 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm shadow-none focus-visible:ring-0'
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(e);
              }
            }}
          />
          {onWhatsAppClick ? (
            <Button
              type='button'
              size='icon'
              variant='ghost'
              onClick={onWhatsAppClick}
              disabled={isDisabled}
              aria-label={t('whatsapp.openModal')}
              data-testid='worky-prompt-whatsapp'
              className='relative size-10 shrink-0 rounded-lg'
            >
              <MessageCircle className='h-4 w-4' />
              {whatsappConnected ? (
                <span
                  className='absolute right-1 top-1 h-2 w-2 rounded-full bg-green-500'
                  data-testid='worky-prompt-whatsapp-connected'
                />
              ) : null}
            </Button>
          ) : null}
          <Button
            type='submit'
            size='icon'
            variant='default'
            disabled={isDisabled || !value.trim()}
            aria-label={t('promptBar.send')}
            data-testid='worky-prompt-send'
            className='size-11 shrink-0 rounded-lg'
          >
            <Send className='h-4 w-4' />
          </Button>
        </div>
      </form>
    </footer>
  );
}
