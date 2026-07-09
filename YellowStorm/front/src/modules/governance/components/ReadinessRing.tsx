import { cn } from '@/lib/utils';

export function readinessTone(score: number): { hex: string; text: string } {
  if (score >= 80) return { hex: '#10b981', text: 'text-emerald-600 dark:text-emerald-400' };
  if (score >= 50) return { hex: '#f59e0b', text: 'text-amber-600 dark:text-amber-400' };
  return { hex: '#ef4444', text: 'text-red-600 dark:text-red-400' };
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
