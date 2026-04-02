import { cn } from '@/lib/utils';
import { PORT_COLORS } from '../utils/port-colors';
import type { ArtifactKind } from '../types';

interface PortLabelProps {
  name: string;
  kind: ArtifactKind;
  position: 'left' | 'right';
}

export function PortLabel({ name, kind, position }: PortLabelProps) {
  const colors = PORT_COLORS[kind];
  if (!colors) return null;

  const Icon = colors.icon;

  return (
    <div
      className={cn(
        'absolute z-50 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap pointer-events-none',
        colors.bg,
        position === 'left' ? 'left-full ml-1' : 'right-full mr-1',
      )}
    >
      <Icon className="h-3 w-3" />
      <span className="text-foreground">{name}</span>
    </div>
  );
}
