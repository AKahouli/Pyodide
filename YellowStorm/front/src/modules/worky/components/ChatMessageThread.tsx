import { useEffect, useMemo, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import {
  ChatConversation,
  ChatConversationContent,
  ChatMessageBubble,
  ChatScrollButton,
  type ChatMessage,
} from '@/components/ai-elements/chat-conversation';
import { mapComponentsToContentParts } from '@/modules/conversation/utils';
import { synthesizeSpeech } from '../api';
import { useWorkyMessages, useWorkyStore } from '../store';
import { cn } from '@/lib/utils';
import { ChatClarificationCard } from './ChatClarificationCard';
import type { WorkyMessage, WorkyPendingClarification } from '../types';

type ChatThreadItem =
  | { kind: 'message'; message: WorkyMessage }
  | { kind: 'clarification'; clarification: WorkyPendingClarification };

/** Extracts a numeric sort key from a createdAt ISO string, falling back to
 *  the timestamp encoded in a MongoDB ObjectId, then to `fallback`. */
function resolveItemTimestamp(createdAt: string | undefined, id: string, fallback: number): number {
  if (createdAt) {
    const parsed = new Date(createdAt).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (/^[0-9a-f]{24}$/i.test(id)) return parseInt(id.slice(0, 8), 16) * 1000;
  return fallback;
}

/** Builds a chronologically-ordered thread by interleaving persisted messages
 *  with pending clarifications so each owner turn is followed immediately by
 *  the manager's reply or question. */
function toChronologicalThread(
  messages: WorkyMessage[],
  clarifications: WorkyPendingClarification[],
): ChatThreadItem[] {
  type SortableItem = ChatThreadItem & { sortAt: number; tieBreaker: number };

  const sortable: SortableItem[] = [
    ...messages.map((message, index): SortableItem => ({
      kind: 'message',
      message,
      sortAt: resolveItemTimestamp(message.createdAt, message.id, 0),
      tieBreaker: index,
    })),
    ...clarifications.map((clarification, index): SortableItem => ({
      kind: 'clarification',
      clarification,
      sortAt: resolveItemTimestamp(clarification.createdAt, clarification.id, Number.MAX_SAFE_INTEGER),
      tieBreaker: messages.length + index,
    })),
  ];

  return sortable
    .sort((a, b) => {
      if (a.sortAt !== b.sortAt) return a.sortAt - b.sortAt;
      // When timestamps are equal, messages come before clarifications.
      if (a.kind !== b.kind) return a.kind === 'message' ? -1 : 1;
      return a.tieBreaker - b.tieBreaker;
    })
    .map(({ kind, ...rest }): ChatThreadItem =>
      kind === 'message'
        ? { kind, message: (rest as { message: WorkyMessage }).message }
        : { kind, clarification: (rest as { clarification: WorkyPendingClarification }).clarification },
    );
}

/** Maps a worky message onto the shared ChatMessage shape the conversation chat
 *  bubble consumes: owner→user (right, primary), manager/system→assistant (left).
 *  Rich components render when present; otherwise the plain-text content. */
function toChatMessage(message: WorkyMessage): ChatMessage {
  const content =
    message.components && message.components.length > 0
      ? mapComponentsToContentParts(message.components)
      : message.content;
  const timestamp = message.createdAt ? new Date(message.createdAt) : undefined;
  return {
    id: message.id,
    role: message.role === 'owner' ? 'user' : 'assistant',
    content,
    timestamp: timestamp && !Number.isNaN(timestamp.getTime()) ? timestamp : undefined,
  };
}
// ponytail: Gemini TTS voice names; update if WORKY_TTS_MODEL changes provider.
const TTS_VOICES = ['Kore', 'Puck', 'Zephyr', 'Charon', 'Fenrir', 'Aoede', 'Leda', 'Orus'];

export function ChatMessageThread({
  streamId,
  className,
}: { streamId?: string; className?: string } = {}): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const messages = useWorkyMessages();
  const streaming = useWorkyStore((s) => s.streaming);
  const pendingClarifications = useWorkyStore((s) => s.pendingClarifications) ?? [];
  const showClarifications = Boolean(streamId) && pendingClarifications.length > 0;
  const threadItems = useMemo(
    () =>
      showClarifications
        ? toChronologicalThread(messages, pendingClarifications)
        : messages.map((message) => ({ kind: 'message' as const, message })),
    [messages, pendingClarifications, showClarifications],
  );
  // Read-aloud: opt-in toggle. When on, each new agent message is spoken via
  // OpenRouter TTS. Off by default so we don't fire paid calls / hit autoplay
  // blocks unprompted.
  const [ttsOn, setTtsOn] = useState(false);
  const [voice, setVoice] = useState(() => localStorage.getItem('worky-tts-voice') ?? TTS_VOICES[0]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSpokenRef = useRef<string | null>(null);
  const initializedRef = useRef(false);

  const chooseVoice = (v: string) => {
    setVoice(v);
    localStorage.setItem('worky-tts-voice', v);
  };

  // Stop audio when muted or unmounted.
  useEffect(() => {
    if (!ttsOn) audioRef.current?.pause();
  }, [ttsOn]);
  useEffect(() => () => audioRef.current?.pause(), []);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last) return;
    // Don't replay history on first load — only speak messages that arrive after.
    if (!initializedRef.current) {
      initializedRef.current = true;
      lastSpokenRef.current = last.id;
      return;
    }
    if (last.id === lastSpokenRef.current) return;
    lastSpokenRef.current = last.id;
    if (!ttsOn || last.role === 'owner' || !last.content?.trim()) return;
    void (async () => {
      try {
        const blob = await synthesizeSpeech(last.content, voice || undefined);
        const url = URL.createObjectURL(blob);
        audioRef.current?.pause();
        const audio = new Audio(url);
        audioRef.current = audio;
        const free = () => URL.revokeObjectURL(url);
        audio.onended = free;
        audio.onerror = free;
        await audio.play().catch(() => undefined); // autoplay may need a gesture
      } catch {
        /* TTS failure is non-fatal — the text answer is already shown. */
      }
    })();
  }, [messages, ttsOn, voice]);

  const hasContent = messages.length > 0 || showClarifications;

  return (
    <section
      data-testid='worky-message-thread'
      aria-label={t('messages.title')}
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border/60 bg-background/30',
        className,
      )}
    >
      <header className='flex items-center justify-between border-b border-border/60 px-3 py-1.5'>
        <h3 className='text-[10px] font-semibold uppercase tracking-wide text-muted-foreground'>
          {t('messages.title')}
        </h3>
        <div className='flex items-center gap-2'>
          {streaming ? (
            <span className='text-[10px] italic text-muted-foreground'>
              {t('messages.streamingLabel')}
            </span>
          ) : null}
          {ttsOn ? (
            <select
              value={voice}
              onChange={(e) => chooseVoice(e.target.value)}
              aria-label={t('messages.speak.voice')}
              title={t('messages.speak.voice')}
              className='rounded border border-border/60 bg-background/60 px-1 py-0.5 text-[10px] text-muted-foreground'
              data-testid='worky-tts-voice'
            >
              {TTS_VOICES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          ) : null}
          <button
            type='button'
            onClick={() => setTtsOn((on) => !on)}
            aria-pressed={ttsOn}
            aria-label={ttsOn ? t('messages.speak.disable') : t('messages.speak.enable')}
            title={ttsOn ? t('messages.speak.disable') : t('messages.speak.enable')}
            className='text-muted-foreground hover:text-foreground'
            data-testid='worky-tts-toggle'
          >
            {ttsOn ? <Volume2 className='h-3.5 w-3.5' /> : <VolumeX className='h-3.5 w-3.5' />}
          </button>
        </div>
      </header>
      {hasContent ? (
        <ChatConversation className='min-h-0 flex-1'>
          <ChatConversationContent
            className='gap-3 px-2 py-2'
            data-testid='worky-message-list'
          >
            {threadItems.map((item) =>
              item.kind === 'message' ? (
                <ChatMessageBubble
                  key={item.message.id}
                  message={toChatMessage(item.message)}
                  density='compact'
                  data-testid={`worky-message-${item.message.role}`}
                />
              ) : (
                <ChatClarificationCard
                  key={item.clarification.id}
                  streamId={streamId as string}
                  clarification={item.clarification}
                />
              ),
            )}
          </ChatConversationContent>
          <ChatScrollButton />
        </ChatConversation>
      ) : (
        <p className='m-auto text-center text-xs text-muted-foreground'>
          {t('messages.empty')}
        </p>
      )}
    </section>
  );
}
