import { useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
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

const DOCK_MARGIN = 8;
const KEYBOARD_MOVE_PX = 10;

interface DockPosition {
  x: number;
  y: number;
}

function clampMovement(rect: DOMRect, deltaX: number, deltaY: number): DockPosition {
  return {
    x: Math.max(
      DOCK_MARGIN - rect.left,
      Math.min(window.innerWidth - DOCK_MARGIN - rect.right, deltaX),
    ),
    y: Math.max(
      DOCK_MARGIN - rect.top,
      Math.min(window.innerHeight - DOCK_MARGIN - rect.bottom, deltaY),
    ),
  };
}

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
  const dockRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origin: DockPosition;
    originRect: DOMRect;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const previousActiveRef = useRef(active);
  const [position, setPosition] = useState<DockPosition>({ x: 0, y: 0 });

  const moveBy = (deltaX: number, deltaY: number, origin = position, originRect?: DOMRect) => {
    const dock = dockRef.current;
    if (!dock) return;
    const movement = clampMovement(originRect ?? dock.getBoundingClientRect(), deltaX, deltaY);
    setPosition({ x: origin.x + movement.x, y: origin.y + movement.y });
  };

  useLayoutEffect(() => {
    const clampToViewport = () => {
      const dock = dockRef.current;
      if (!dock) return;
      const correction = clampMovement(dock.getBoundingClientRect(), 0, 0);
      if (correction.x === 0 && correction.y === 0) return;
      setPosition((current) => ({ x: current.x + correction.x, y: current.y + correction.y }));
    };
    if (previousActiveRef.current !== active) clampToViewport();
    previousActiveRef.current = active;
    window.addEventListener('resize', clampToViewport);
    return () => window.removeEventListener('resize', clampToViewport);
  }, [active]);

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    // Don't drag/capture when pressing a child action button: pointer capture
    // retargets the resulting click to the capturing container, so the button's
    // onClick never fires. (Idle mode's drag root IS the button, so allow that.)
    const pressed = (event.target as HTMLElement).closest('button');
    if (pressed && pressed !== event.currentTarget) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: position,
      originRect: event.currentTarget.getBoundingClientRect(),
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(deltaX) <= 4 && Math.abs(deltaY) <= 4) return;
    drag.moved = true;
    event.preventDefault();
    moveBy(deltaX, deltaY, drag.origin, drag.originRect);
  };

  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressClickRef.current = drag.moved;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const handleClickCapture = (event: MouseEvent<HTMLElement>) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const delta = event.shiftKey ? KEYBOARD_MOVE_PX * 5 : KEYBOARD_MOVE_PX;
    const movement = {
      ArrowLeft: [-delta, 0],
      ArrowRight: [delta, 0],
      ArrowUp: [0, -delta],
      ArrowDown: [0, delta],
    }[event.key];
    if (!movement) return;
    event.preventDefault();
    moveBy(movement[0], movement[1]);
  };

  const dragProps = {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: () => { dragRef.current = null; },
    onClickCapture: handleClickCapture,
    onKeyDown: handleKeyDown,
  };
  const dockStyle = {
    transform: `translate(calc(-50% + ${position.x}px), ${position.y}px)`,
  };

  if (!active) {
    return (
      <div className='pointer-events-none fixed inset-0 z-40'>
        <button
          ref={(element) => { dockRef.current = element; }}
          type="button"
          onClick={onToggle}
          aria-label={t('nav.voice')}
          aria-describedby='worky-voice-dock-instructions'
          style={dockStyle}
          className="pointer-events-auto absolute bottom-6 left-1/2 flex touch-none select-none cursor-grab items-center gap-3 rounded-full border border-border bg-card/95 py-2 pr-2 pl-4 shadow-lg backdrop-blur transition-colors hover:bg-accent/40 active:cursor-grabbing"
          {...dragProps}
        >
          <span className="flex flex-col text-left">
            <span className="text-sm font-semibold text-foreground">{t('voice.manager')}</span>
            <span className="text-xs text-muted-foreground">{t('voice.tapToTalk')}</span>
          </span>
          <span className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
            <Mic className="size-5" />
          </span>
        </button>
        <span id='worky-voice-dock-instructions' className='sr-only'>
          {t('voice.dragInstructions')}
        </span>
      </div>
    );
  }

  // Scale the mic with the live input level while listening; a steady bump while speaking.
  const pulse = state === 'listening' ? 1 + Math.min(0.4, level * 0.8) : state === 'speaking' ? 1.15 : 1;

  return (
    <div className='pointer-events-none fixed inset-0 z-40'>
      <div
        ref={(element) => { dockRef.current = element; }}
        data-testid="voice-dock-live"
        role='group'
        tabIndex={0}
        aria-label={t('voice.manager')}
        aria-describedby='worky-voice-dock-instructions'
        style={dockStyle}
        className="pointer-events-auto absolute bottom-6 left-1/2 flex touch-none select-none cursor-grab items-center gap-3 rounded-full border border-border bg-card/95 py-2 pr-2 pl-4 shadow-lg backdrop-blur active:cursor-grabbing"
        {...dragProps}
      >
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
      <span id='worky-voice-dock-instructions' className='sr-only'>
        {t('voice.dragInstructions')}
      </span>
    </div>
  );
}
