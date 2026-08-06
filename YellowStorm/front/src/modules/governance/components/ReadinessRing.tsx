import { cn } from '@/lib/utils';

export function readinessTone(score: number): { hex: string; text: string } {
  if (score >= 80) return { hex: '#047857', text: 'text-emerald-700 dark:text-emerald-300' };
  if (score >= 50) return { hex: '#b45309', text: 'text-amber-700 dark:text-amber-300' };
  return { hex: '#b91c1c', text: 'text-red-700 dark:text-red-300' };
}

export function ReadinessRing({ score, size = 44 }: Readonly<{ score: number; size?: number }>): JSX.Element {
  const tone = readinessTone(score);
  return (
    <span className='relative grid flex-none place-items-center rounded-full' style={{ width: size, height: size, background: `conic-gradient(${tone.hex} ${score}%, var(--border) 0)` }}>
      <span className='absolute rounded-full bg-card' style={{ inset: Math.round(size * 0.1) }} />
      <span className={cn('relative font-semibold tabular-nums', tone.text)} style={{ fontSize: size <= 44 ? 12 : 17 }}>{score}</span>
    </span>
  );
}
