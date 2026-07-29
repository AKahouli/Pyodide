import type { JSX } from 'react';
import { Mic } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VoiceState } from '../../voice/useVoiceSession';

/** Glowing voice orb; pulses while listening or speaking. */
export function VoiceOrb({ state }: { state: VoiceState }): JSX.Element {
  const active = state === 'listening' || state === 'speaking';
  return (
    <div className="relative flex size-56 items-center justify-center">
      <div className={cn('absolute inset-0 rounded-full bg-primary/20 blur-2xl', active && 'animate-pulse')} />
      <div className="absolute inset-4 rounded-full ring-2 ring-primary/60" />
      <div className="flex size-36 items-center justify-center rounded-full bg-card shadow-inner">
        <Mic className={cn('size-14 text-primary', active && 'animate-pulse')} />
      </div>
    </div>
  );
}
