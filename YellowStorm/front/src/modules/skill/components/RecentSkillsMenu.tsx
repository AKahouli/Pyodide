import { useMemo } from 'react';
import { Check, Loader2, Settings2, Sparkles } from 'lucide-react';
import {
  PromptInputActionMenuSub,
  PromptInputActionMenuSubContent,
  PromptInputActionMenuSubTrigger,
} from '@/components/ai-elements/prompt-input';
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { useModuleTranslation } from '@/modules/localization';
import type { SkillOption } from '@/modules/agent/types';
import { SkillLogo } from './SkillLogo';
import { useRecentSkills } from '../useRecentSkills';

const SYSTEM_CATEGORY_NAME = 'system';
const MAX_VISIBLE = 5;

interface RecentSkillsMenuProps {
  skills: SkillOption[];
  loading: boolean;
  /** IDs of skills currently selected for the conversation. */
  selectedIds: string[];
  /** Toggles a skill for the conversation. */
  onSelectSkill: (skill: SkillOption) => void;
  /** Opens the full management modal. */
  onOpenManage: () => void;
}

/**
 * The "+ → Skills" submenu: shows recently-used skills (logo, name) and a
 * persistent "Manage skills" entry. Selecting a skill toggles it for the whole
 * conversation; selected skills are sent with every message.
 */
export function RecentSkillsMenu({ skills, loading, selectedIds, onSelectSkill, onOpenManage }: RecentSkillsMenuProps) {
  const { t } = useModuleTranslation('common');
  const { recentIds } = useRecentSkills();

  const nonSystem = useMemo(
    () => skills.filter((s) => (s.categoryName ?? '').toLowerCase() !== SYSTEM_CATEGORY_NAME),
    [skills],
  );

  // Recently-used first (in stored order); fall back to the first few available skills.
  const recentSkills = useMemo(() => {
    const byId = new Map(nonSystem.map((s) => [s.id, s]));
    const ordered = recentIds.map((id) => byId.get(id)).filter((s): s is SkillOption => Boolean(s));
    if (ordered.length > 0) return ordered.slice(0, MAX_VISIBLE);
    return nonSystem.slice(0, MAX_VISIBLE);
  }, [nonSystem, recentIds]);

  return (
    <PromptInputActionMenuSub>
      <PromptInputActionMenuSubTrigger>
        <Sparkles className='mr-2 size-4' /> {t('input.skills') || 'Skills'}
      </PromptInputActionMenuSubTrigger>
      <PromptInputActionMenuSubContent className='min-w-64'>
        <DropdownMenuLabel className='text-xs font-normal text-muted-foreground'>
          {t('skills.recent') || 'Recent skills'}
        </DropdownMenuLabel>
        {loading ? (
          <div className='flex items-center justify-center py-2'>
            <Loader2 className='size-4 animate-spin' />
          </div>
        ) : recentSkills.length === 0 ? (
          <div className='px-2 py-2 text-sm text-muted-foreground'>
            {t('skills.noSkills') || 'No skills available'}
          </div>
        ) : (
          recentSkills.map((skill) => {
            const isSelected = selectedIds.includes(skill.id);
            return (
              <DropdownMenuItem
                key={skill.id}
                className='gap-2'
                // Keep the menu open so several skills can be toggled in a row.
                onSelect={(e) => {
                  e.preventDefault();
                  onSelectSkill(skill);
                }}>
                <SkillLogo skill={skill} size={24} />
                <span className='flex-1 truncate font-medium'>{skill.name}</span>
                {isSelected && <Check className='size-4 text-primary' />}
              </DropdownMenuItem>
            );
          })
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem className='gap-2' onSelect={() => onOpenManage()}>
          <Settings2 className='size-4' />
          {t('skills.manage') || 'Manage skills'}
        </DropdownMenuItem>
      </PromptInputActionMenuSubContent>
    </PromptInputActionMenuSub>
  );
}
