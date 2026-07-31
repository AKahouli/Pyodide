import type { JSX } from 'react';
import { cn } from '@/lib/utils';
import type { WorkyAgentStatus } from '../../agents/agentModel';

const RING: Record<WorkyAgentStatus, string> = {
  working: 'ring-worky-working',
  blocked: 'ring-worky-blocked',
  idle: 'ring-worky-idle',
  done: 'ring-worky-done',
};

// Deterministic tint palette for agent bodies (not theme tokens — avatar accents).
const PALETTE = [
  '#6366f1', '#0891b2', '#db2777', '#0d9488', '#7c3aed',
  '#b45309', '#be123c', '#1d4ed8', '#0369a1', '#9333ea',
];

function seedIndex(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % PALETTE.length;
}

export function AgentAvatar({
  initials,
  colorSeed,
  status,
  size = 48,
  className,
}: {
  initials: string;
  colorSeed: string;
  status: WorkyAgentStatus;
  size?: number;
  className?: string;
}): JSX.Element {
  return (
    <div
      className={cn('relative inline-flex shrink-0 items-center justify-center rounded-full ring-2', RING[status], className)}
      style={{ width: size, height: size }}
    >
      <div
        className="flex items-center justify-center rounded-full font-semibold text-white"
        style={{
          width: size - 8,
          height: size - 8,
          backgroundColor: PALETTE[seedIndex(colorSeed)],
          fontSize: Math.round(size * 0.34),
        }}
      >
        {initials}
      </div>
    </div>
  );
}
