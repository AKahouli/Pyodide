import { useEffect, useRef, useState } from 'react';
import type { VoiceSessionApi } from './useVoiceSession';
import { useVoiceSession } from './useVoiceSession';
import { useRealtimeVoiceSession } from './useRealtimeVoiceSession';
import { useVoiceSettings } from './voiceSettings';

/**
 * Shared voice session used by both the desktop dock and the mobile sheet.
 * Instantiates the realtime and legacy engines, selects realtime unless it has
 * errored (then falls back to legacy), and starts/stops the active engine
 * whenever `active` flips. Returns the standard VoiceSessionApi plus which
 * engine is live.
 */
export function useWorkyVoiceSession(
  streamId: string,
  active: boolean,
): VoiceSessionApi & { usingRealtime: boolean } {
  const realtimeVoice = useVoiceSettings((s) => s.realtimeVoice);
  const [fellBack, setFellBack] = useState(false);
  const useRealtime = realtimeVoice && !fellBack;

  const realtime = useRealtimeVoiceSession(useRealtime ? streamId : '');
  const legacy = useVoiceSession(useRealtime ? '' : streamId);
  const session = useRealtime ? realtime : legacy;

  useEffect(() => {
    if (realtimeVoice && realtime.error && !fellBack) setFellBack(true);
  }, [realtimeVoice, realtime.error, fellBack]);

  const startRef = useRef(session.start);
  const stopRef = useRef(session.stop);
  startRef.current = session.start;
  stopRef.current = session.stop;

  useEffect(() => {
    if (!active) return undefined;
    const startNow = startRef.current;
    const stopThis = stopRef.current;
    startNow();
    return () => stopThis();
  }, [active, useRealtime]);

  return { ...session, usingRealtime: useRealtime };
}
