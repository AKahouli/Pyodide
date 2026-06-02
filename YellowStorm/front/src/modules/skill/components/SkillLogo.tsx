import { memo } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconDisplay } from '@/modules/admin/pages/connectors/IconDisplay';
import type { SkillOption } from '@/modules/agent/types';

interface SkillLogoProps {
  skill: Pick<SkillOption, 'name' | 'icon' | 'color' | 'iconColor'>;
  /** Pixel size of the square logo box. */
  size?: number;
  className?: string;
}

/**
 * Renders a skill's logo: its configured react-icon over its brand color,
 * falling back to the name initial, then a generic Sparkles glyph.
 */
export const SkillLogo = memo(function SkillLogo({ skill, size = 32, className }: SkillLogoProps) {
  const iconTextColor = skill.iconColor === 'dark' ? 'text-black' : 'text-white';
  const initial = skill.name?.trim().charAt(0).toUpperCase();

  return (
    <div
      className={cn('flex shrink-0 items-center justify-center rounded-md', !skill.color && 'bg-muted', className)}
      style={{ width: size, height: size, backgroundColor: skill.color || undefined }}
    >
      {skill.icon ? (
        <IconDisplay icon={skill.icon} size={Math.round(size * 0.62)} iconColor={skill.iconColor ?? 'light'} />
      ) : initial ? (
        <span className={cn('text-sm font-bold', skill.color ? iconTextColor : 'text-foreground')}>{initial}</span>
      ) : (
        <Sparkles className='size-4 text-muted-foreground' />
      )}
    </div>
  );
});
