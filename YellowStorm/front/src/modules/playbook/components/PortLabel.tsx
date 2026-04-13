import { cn } from '@/lib/utils';
import { PORT_COLORS } from '../utils/port-colors';
import type { ArtifactKind } from '../types';

interface PortLabelProps {
  name: string;
  kind: ArtifactKind;
  position: 'left' | 'right';
  selected?: boolean;
}

export function PortLabel({ name, kind, position, selected = false }: PortLabelProps) {
  const colors = PORT_COLORS[kind];
  if (!colors) return null;

  const Icon = colors.icon;

  return (
    <div
      title={name}
      className={cn(
        'absolute z-50 flex h-6 max-w-[148px] items-center gap-1 rounded-md border px-2 text-[10px] font-medium shadow-sm backdrop-blur-[1px]',
        'border-border/70 bg-background/95 text-muted-foreground',
        selected && 'border-[#ffcd03]/70 bg-[#ffcd03]/12 text-foreground shadow-[0_0_0_1px_rgba(255,205,3,0.18)]',
        position === 'left' ? 'right-full mr-3' : 'left-full ml-3',
      )}
    >
      <Icon className={cn('h-3 w-3 shrink-0', selected && 'text-foreground')} style={selected ? undefined : { color: colors.raw }} />
      <span className={cn('min-w-0 truncate', selected ? 'text-foreground' : 'text-foreground/85')}>{name}</span>
    </div>
  );
}
