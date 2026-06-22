import { useMemo } from 'react';
import { X } from 'lucide-react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import type { SkillOption } from '@/modules/agent/types';
import { SkillLogo } from './SkillLogo';

const MAX_VISIBLE_SKILL_PILLS = 3;

interface SelectedSkillsPillsProps {
  skills: SkillOption[];
  selectedIds: string[];
  onRemove: (id: string) => void;
}

/**
 * Pills showing the skills selected for the conversation: logo + name + a remove
 * button, with the overflow collapsed into a "+N" hover card. Shared by the v1
 * composer (input.tsx) and the v2 composers so both look identical.
 */
export function SelectedSkillsPills({ skills, selectedIds, onRemove }: SelectedSkillsPillsProps) {
  const selected = useMemo(
    () => selectedIds.map((id) => skills.find((s) => s.id === id)).filter((s): s is SkillOption => Boolean(s)),
    [selectedIds, skills],
  );
  if (selected.length === 0) return null;

  const visible = selected.slice(0, MAX_VISIBLE_SKILL_PILLS);
  const overflow = selected.slice(MAX_VISIBLE_SKILL_PILLS);

  return (
    <div className='flex flex-wrap items-center gap-1.5 px-1 pt-2'>
      {visible.map((skill) => (
        <span key={skill.id} className='inline-flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pl-1.5 pr-1 text-xs'>
          <SkillLogo skill={skill} size={14} />
          <span className='max-w-[140px] truncate'>{skill.name}</span>
          <button
            type='button'
            onClick={() => onRemove(skill.id)}
            className='rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground'
            aria-label={`Retirer ${skill.name}`}>
            <X className='size-3' />
          </button>
        </span>
      ))}
      {overflow.length > 0 && (
        <HoverCard openDelay={100} closeDelay={150}>
          <HoverCardTrigger asChild>
            <span className='inline-flex cursor-default items-center rounded-full border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground'>
              +{overflow.length}
            </span>
          </HoverCardTrigger>
          <HoverCardContent className='w-60 p-1.5'>
            <div className='flex flex-col gap-0.5'>
              {overflow.map((skill) => (
                <div key={skill.id} className='flex items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-muted'>
                  <SkillLogo skill={skill} size={14} />
                  <span className='flex-1 truncate'>{skill.name}</span>
                  <button
                    type='button'
                    onClick={() => onRemove(skill.id)}
                    className='rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground'
                    aria-label={`Retirer ${skill.name}`}>
                    <X className='size-3' />
                  </button>
                </div>
              ))}
            </div>
          </HoverCardContent>
        </HoverCard>
      )}
    </div>
  );
}
