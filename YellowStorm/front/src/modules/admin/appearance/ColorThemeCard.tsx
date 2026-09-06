import { Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ColorTheme } from '@/contexts/ThemeContext';
import { THEME_PALETTES } from './constants';

interface ColorThemeCardProps {
  value: ColorTheme;
  label: string;
  selected: boolean;
  isActive: boolean;
  activeLabel: string;
  onSelect: (value: ColorTheme) => void;
}

export function ColorThemeCard({ value, label, selected, isActive, activeLabel, onSelect }: ColorThemeCardProps) {
  const palette = THEME_PALETTES[value];

  return (
    <button
      type='button'
      role='radio'
      aria-checked={selected}
      aria-label={label}
      onClick={() => onSelect(value)}
      className={cn(
        'group flex flex-col overflow-hidden rounded-2xl border text-left transition-all',
        'hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        selected ? 'border-primary shadow-md ring-2 ring-primary/20' : 'border-border',
      )}>
      <div className='relative h-32 overflow-hidden' style={{ background: palette.surface }} aria-hidden>
        <div className='absolute inset-x-3 top-3 flex items-center gap-1.5'>
          <span className='h-1.5 w-1.5 rounded-full opacity-40' style={{ background: palette.primary }} />
          <span className='h-1.5 w-1.5 rounded-full opacity-25' style={{ background: palette.primary }} />
          <span className='h-1.5 w-1.5 rounded-full opacity-15' style={{ background: palette.primary }} />
        </div>
        <div className='absolute inset-y-8 left-3 w-10 rounded-md' style={{ background: palette.sidebar }} />
        <div className='absolute left-[4.25rem] right-3 top-8 space-y-2'>
          <div className='h-2 w-2/5 rounded-full' style={{ background: palette.muted }} />
          <div className='h-2 w-3/4 rounded-full' style={{ background: palette.muted }} />
          <div className='mt-3 h-8 w-[4.5rem] rounded-md shadow-sm' style={{ background: palette.primary }} />
        </div>
        {selected ? (
          <span
            className='absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-full shadow-sm'
            style={{ background: palette.primary, color: palette.onPrimary }}>
            <Check className='h-3.5 w-3.5' strokeWidth={3} />
          </span>
        ) : null}
      </div>
      <div className='flex items-center justify-between gap-3 px-3 py-3'>
        <div className='min-w-0'>
          <p className={cn('truncate text-sm font-medium', selected && 'text-foreground')}>{label}</p>
          {isActive ? (
            <Badge variant='secondary' className='mt-1.5 font-normal'>
              {activeLabel}
            </Badge>
          ) : null}
        </div>
        <div className='flex shrink-0 -space-x-1' aria-hidden>
          {[palette.primary, palette.sidebar, palette.muted].map((color) => (
            <span key={color} className='h-4 w-4 rounded-full border border-background shadow-sm' style={{ background: color }} />
          ))}
        </div>
      </div>
    </button>
  );
}
