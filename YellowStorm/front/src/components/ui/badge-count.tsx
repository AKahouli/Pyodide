import { cn } from '@/lib/utils';

type BadgeCountProps = Readonly<{
  count: number;
  className?: string;
}>;

export function BadgeCount({ count, className }: BadgeCountProps) {
  if (count <= 0) return null;

  const displayCount = count >= 100 ? '+99' : count;

  return <div className={cn('absolute top-0 right-0 flex items-center justify-center', 'min-w-4 h-4 px-0.5 text-[10px] font-semibold', 'rounded-full bg-primary text-primary-foreground', 'translate-x-1/2 -translate-y-1/2', className)}>{displayCount}</div>;
}
