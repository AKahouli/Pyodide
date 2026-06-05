import { memo } from 'react';
import { Cable } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconDisplay } from '@/modules/admin/pages/connectors/IconDisplay';
import type { ConnectorOption } from '@/modules/agent/api';

interface ConnectorLogoProps {
  connector: Pick<ConnectorOption, 'name' | 'icon' | 'color' | 'iconColor'>;
  /** Pixel size of the square logo box. */
  size?: number;
  className?: string;
}

/**
 * Renders a connector's logo: its configured react-icon over its brand color,
 * falling back to the name initial, then a generic Cable glyph.
 */
export const ConnectorLogo = memo(function ConnectorLogo({ connector, size = 32, className }: ConnectorLogoProps) {
  const iconTextColor = connector.iconColor === 'dark' ? 'text-black' : 'text-white';
  const initial = connector.name?.trim().charAt(0).toUpperCase();

  return (
    <div
      className={cn('flex shrink-0 items-center justify-center rounded-md', !connector.color && 'bg-muted', className)}
      style={{ width: size, height: size, backgroundColor: connector.color || undefined }}
    >
      {connector.icon ? (
        <IconDisplay icon={connector.icon} size={Math.round(size * 0.62)} iconColor={connector.iconColor ?? 'light'} />
      ) : initial ? (
        <span className={cn('text-sm font-bold', connector.color ? iconTextColor : 'text-foreground')}>{initial}</span>
      ) : (
        <Cable className='size-4 text-muted-foreground' />
      )}
    </div>
  );
});
