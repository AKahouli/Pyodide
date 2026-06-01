/**
 * IconDisplay - Renders react-icons by name (FaGithub, CiSearch, MdHome, ...).
 * Each react-icons subpackage is loaded lazily on first use.
 */

import { useEffect, useState } from 'react';
import type { IconType } from 'react-icons';

type IconModule = Record<string, unknown>;

// Prefix → loader for the matching react-icons subpackage.
const COLLECTION_LOADERS: Record<string, () => Promise<IconModule>> = {
  Ai: () => import('react-icons/ai'),
  Bi: () => import('react-icons/bi'),
  Bs: () => import('react-icons/bs'),
  Cg: () => import('react-icons/cg'),
  Ci: () => import('react-icons/ci'),
  Di: () => import('react-icons/di'),
  Fa6: () => import('react-icons/fa6'),
  Fa: () => import('react-icons/fa'),
  Fc: () => import('react-icons/fc'),
  Fi: () => import('react-icons/fi'),
  Gi: () => import('react-icons/gi'),
  Go: () => import('react-icons/go'),
  Gr: () => import('react-icons/gr'),
  Hi2: () => import('react-icons/hi2'),
  Hi: () => import('react-icons/hi'),
  Im: () => import('react-icons/im'),
  Io5: () => import('react-icons/io5'),
  Io: () => import('react-icons/io'),
  Lia: () => import('react-icons/lia'),
  Lu: () => import('react-icons/lu'),
  Md: () => import('react-icons/md'),
  Pi: () => import('react-icons/pi'),
  Ri: () => import('react-icons/ri'),
  Rx: () => import('react-icons/rx'),
  Si: () => import('react-icons/si'),
  Sl: () => import('react-icons/sl'),
  Tb: () => import('react-icons/tb'),
  Tfi: () => import('react-icons/tfi'),
  Ti: () => import('react-icons/ti'),
  Vsc: () => import('react-icons/vsc'),
  Wi: () => import('react-icons/wi'),
};

// Longer prefixes first to avoid Hi/Hi2, Io/Io5, Fa/Fa6, Li/Lia collisions.
const PREFIXES = Object.keys(COLLECTION_LOADERS).sort((a, b) => b.length - a.length);

function findPrefix(name: string): string | null {
  for (const p of PREFIXES) {
    const re = new RegExp(`^${p}[A-Z0-9]`);
    if (re.test(name)) return p;
  }
  return null;
}

interface IconDisplayProps {
  icon?: string;
  size?: number;
  className?: string;
  iconColor?: 'light' | 'dark';
}

export function IconDisplay({ icon, size = 24, className = '', iconColor = 'light' }: Readonly<IconDisplayProps>) {
  const [IconComponent, setIconComponent] = useState<IconType | null>(null);

  useEffect(() => {
    if (!icon) {
      setIconComponent(null);
      return;
    }
    const name = icon.trim();
    const prefix = findPrefix(name);
    if (!prefix) {
      setIconComponent(null);
      return;
    }

    let cancelled = false;
    COLLECTION_LOADERS[prefix]()
      .then((mod) => {
        if (cancelled) return;
        const Comp = mod[name];
        setIconComponent(() => (typeof Comp === 'function' ? (Comp as IconType) : null));
      })
      .catch(() => {
        if (!cancelled) setIconComponent(null);
      });

    return () => {
      cancelled = true;
    };
  }, [icon]);

  if (!icon || !IconComponent) {
    return <div style={{ width: size, height: size }} />;
  }

  const textColor = iconColor === 'light' ? '#ffffff' : '#000000';

  return <IconComponent size={size} color={textColor} className={className} />;
}

interface IconPickerPreviewProps {
  icon?: string;
  color?: string;
  iconColor?: 'light' | 'dark';
  onClear?: () => void;
  onToggleColorMode?: () => void;
}

export function IconPickerPreview({ icon, color, iconColor = 'light', onClear, onToggleColorMode }: Readonly<IconPickerPreviewProps>) {
  if (!icon) {
    return (
      <div className='flex items-center justify-center w-10 h-10 rounded-md border border-dashed border-muted-foreground/30'>
        <span className='text-xs text-muted-foreground/50'>Icon</span>
      </div>
    );
  }

  const hasColorBackground = !!color;

  return (
    <div className='relative group'>
      <div className='w-10 h-10 rounded-md flex items-center justify-center' style={{ backgroundColor: color || 'transparent' }}>
        <IconDisplay icon={icon} size={20} iconColor={hasColorBackground ? iconColor : 'light'} />
      </div>

      {hasColorBackground && (
        <div className='absolute -top-2 -right-2 flex gap-1'>
          {onToggleColorMode && (
            <button
              type='button'
              onClick={onToggleColorMode}
              className='w-5 h-5 bg-background border border-border rounded-full flex items-center justify-center shadow-sm hover:bg-muted transition-colors text-xs'
              title={iconColor === 'light' ? 'Switch to dark icon' : 'Switch to light icon'}
            >
              {iconColor === 'light' ? '◐' : '◑'}
            </button>
          )}
          {onClear && (
            <button
              type='button'
              onClick={onClear}
              className='w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center shadow-sm hover:scale-110 transition-transform text-xs'
              title='Clear icon'
            >
              ×
            </button>
          )}
        </div>
      )}

      {!hasColorBackground && onClear && (
        <button
          type='button'
          onClick={onClear}
          className='absolute -top-1 -right-1 w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs hover:scale-110'
        >
          ×
        </button>
      )}
    </div>
  );
}
