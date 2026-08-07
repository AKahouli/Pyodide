import { useMemo, useState } from 'react';
import { Check, Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useModuleTranslation } from '@/modules/localization';
import type { SkillOption } from '@/modules/agent/types';
import { SkillLogo } from './SkillLogo';

const SYSTEM_CATEGORY_NAME = 'system';
const ALL_CATEGORIES = '__all__';
const UNCATEGORIZED = '__uncategorized__';

interface ManageSkillsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skills: SkillOption[];
  loading?: boolean;
  /** IDs of skills currently selected for the conversation. */
  selectedIds: string[];
  /** Toggles a skill for the conversation. */
  onToggleSkill: (skill: SkillOption) => void;
}

interface SkillGroup {
  key: string;
  name: string;
  items: SkillOption[];
}

/**
 * Full skill catalog modal: skills grouped by category, 2 per row, System excluded.
 * Clicking a skill toggles it for the whole conversation; selected skills are sent
 * with every message.
 */
export function ManageSkillsDialog({ open, onOpenChange, skills, loading, selectedIds, onToggleSkill }: ManageSkillsDialogProps) {
  const { t } = useModuleTranslation('common');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_CATEGORIES);

  // Everything except System skills — the pool the modal shows.
  const available = useMemo(
    () => skills.filter((s) => (s.categoryName ?? '').toLowerCase() !== SYSTEM_CATEGORY_NAME),
    [skills],
  );

  // Distinct category names present (sorted), for the filter dropdown.
  const categories = useMemo(() => {
    const names = new Set<string>();
    for (const s of available) {
      if (s.categoryName) names.add(s.categoryName);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [available]);

  const hasUncategorized = useMemo(() => available.some((s) => !s.categoryName), [available]);

  // Apply search + category filter, then group by category (categorized first, uncategorized last).
  const groups = useMemo<SkillGroup[]>(() => {
    const query = search.trim().toLowerCase();
    const matching = available.filter((s) => {
      const matchesCategory =
        categoryFilter === ALL_CATEGORIES ||
        (categoryFilter === UNCATEGORIZED ? !s.categoryName : s.categoryName === categoryFilter);
      const matchesSearch =
        !query ||
        s.name.toLowerCase().includes(query) ||
        (s.description ?? '').toLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });

    const byCategory = new Map<string, SkillOption[]>();
    for (const s of matching) {
      const key = s.categoryName || UNCATEGORIZED;
      const list = byCategory.get(key) ?? [];
      list.push(s);
      byCategory.set(key, list);
    }

    const result: SkillGroup[] = [];
    for (const name of categories) {
      const items = byCategory.get(name);
      if (items && items.length > 0) result.push({ key: name, name, items });
    }
    const uncategorized = byCategory.get(UNCATEGORIZED);
    if (uncategorized && uncategorized.length > 0) {
      result.push({ key: UNCATEGORIZED, name: t('skills.uncategorized') || 'Uncategorized', items: uncategorized });
    }
    return result;
  }, [available, categories, categoryFilter, search, t]);

  const isEmpty = groups.length === 0;
  const isFiltered = Boolean(search) || categoryFilter !== ALL_CATEGORIES;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>{t('skills.manageTitle') || 'Manage skills'}</DialogTitle>
        </DialogHeader>

        <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
          <div className='relative w-full sm:flex-1'>
            <Search className='absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
            <Input
              placeholder={t('skills.searchPlaceholder') || 'Search skills'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className='pl-9'
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className='w-full sm:w-[200px]'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CATEGORIES}>{t('skills.allCategories') || 'All categories'}</SelectItem>
              {categories.map((name) => (
                <SelectItem key={`category-${name}`} value={name}>{name}</SelectItem>
              ))}
              {hasUncategorized && (
                <SelectItem value={UNCATEGORIZED}>{t('skills.uncategorized') || 'Uncategorized'}</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        <div className='py-1'>
          {loading ? (
            <div className='flex items-center justify-center py-12'>
              <Loader2 className='size-6 animate-spin text-muted-foreground' />
            </div>
          ) : isEmpty ? (
            <div className='py-12 text-center text-sm text-muted-foreground'>
              {isFiltered
                ? t('skills.noMatch') || 'No skills match your filters'
                : t('skills.noSkills') || 'No skills available'}
            </div>
          ) : (
            <ScrollArea className='h-[440px] pr-3'>
              <div className='space-y-6'>
                {groups.map((group) => (
                  <section key={group.key} className='space-y-2'>
                    <div className='flex items-center gap-3'>
                      <h3 className='text-sm font-semibold text-muted-foreground'>{group.name}</h3>
                      <div className='h-px flex-1 bg-border' />
                      <span className='text-xs text-muted-foreground'>{group.items.length}</span>
                    </div>
                    <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
                      {group.items.map((skill) => {
                        const isSelected = selectedIds.includes(skill.id);
                        return (
                          <button
                            key={skill.id}
                            type='button'
                            onClick={() => onToggleSkill(skill)}
                            aria-pressed={isSelected}
                            className={cn(
                              'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent',
                              isSelected && 'border-primary bg-primary/5',
                            )}>
                            <SkillLogo skill={skill} size={40} />
                            <div className='min-w-0 flex-1'>
                              <span className='block truncate text-sm font-medium'>{skill.name}</span>
                              {skill.description && (
                                <p className='truncate text-xs text-muted-foreground'>{skill.description}</p>
                              )}
                            </div>
                            {isSelected && <Check className='size-4 shrink-0 text-primary' />}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
