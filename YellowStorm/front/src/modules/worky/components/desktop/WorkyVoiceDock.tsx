import type { JSX } from 'react';
import { Mic, MicOff, PhoneOff, Settings2, MessageSquare } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { cn } from '@/lib/utils';
import type { VoiceState } from '../../voice/useVoiceSession';

export interface WorkyVoiceDockProps {
  state: VoiceState;
  level: number;
  muted: boolean;
  active: boolean;
  onToggle: () => void;
  onMute: () => void;
  onOpenSettings: () => void;
  onOpenPrompt: () => void;
}

const STATE_LABEL = {
  idle: 'voice.idle',
  listening: 'voice.listening',
  thinking: 'voice.thinking',
  speaking: 'voice.speaking',
} as const satisfies Record<VoiceState, string>;

/**
 * Bottom-center voice dock. Idle: a "tap to talk" pill. Active: an inline live
 * control (animated mic + state, mute, prompt, settings, hang-up) so the user
 * keeps the stream visible while talking. Presentational only — all session
 * state is passed in from the hosting page.
 */
export function WorkyVoiceDock({
  state,
  level,
  muted,
  active,
  onToggle,
  onMute,
  onOpenSettings,
  onOpenPrompt,
}: WorkyVoiceDockProps): JSX.Element {
  const { t } = useModuleTranslation('worky');

  if (!active) {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-20 flex justify-center">
        <button
          type="button"
          onClick={onToggle}
          aria-label={t('nav.voice')}
          className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-card/95 py-2 pr-2 pl-4 shadow-lg backdrop-blur transition-colors hover:bg-accent/40"
        >
          <span className="flex flex-col text-left">
            <span className="text-sm font-semibold text-foreground">{t('voice.manager')}</span>
            <span className="text-xs text-muted-foreground">{t('voice.tapToTalk')}</span>
          </span>
          <span className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
            <Mic className="size-5" />
          </span>
        </button>
      </div>
    );
  }

  // Scale the mic with the live input level while listening; a steady bump while speaking.
  const pulse = state === 'listening' ? 1 + Math.min(0.4, level * 0.8) : state === 'speaking' ? 1.15 : 1;

  return (
    <div data-testid="voice-dock-live" className="pointer-events-none fixed inset-x-0 bottom-6 z-20 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-card/95 py-2 pr-2 pl-4 shadow-lg backdrop-blur">
        <span
          className={cn(
            'flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow transition-transform',
            state === 'speaking' && 'animate-pulse',
          )}
          style={{ transform: `scale(${pulse})` }}
        >
          <Mic className="size-4" />
        </span>
        <span className="min-w-24 text-sm font-semibold text-foreground">
          {muted ? t('voice.muted') : t(STATE_LABEL[state])}
        </span>
        <button
          type="button"
          aria-label={t('voicePrompt.title')}
          onClick={onOpenPrompt}
          className="flex size-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground"
        >
          <MessageSquare className="size-4" />
        </button>
        <button
          type="button"
          aria-label={t('voiceSettings.title')}
          onClick={onOpenSettings}
          className="flex size-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground"
        >
          <Settings2 className="size-4" />
        </button>
        <button
          type="button"
          aria-label={muted ? t('voice.unmute') : t('voice.mute')}
          onClick={onMute}
          className="flex size-9 items-center justify-center rounded-full border border-border bg-card text-foreground"
        >
          {muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
        </button>
        <button
          type="button"
          aria-label={t('voice.end')}
          onClick={onToggle}
          className="flex size-10 items-center justify-center rounded-full bg-destructive text-white"
        >
          <PhoneOff className="size-4" />
        </button>
      </div>
    </div>
  );
}
