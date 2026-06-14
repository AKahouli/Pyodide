import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Search, Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { ResizablePanel, OverflowTooltip } from '@/components/ui/resizable-panel';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { getActiveSkills } from '@/modules/agent/api';
import type { SkillOption } from '@/modules/agent/types';

interface SkillWithState extends SkillOption {
  expanded: boolean;
}

export interface SkillDropPayload {
  type: 'skill';
  skillId: string;
  skillName: string;
}

interface SkillSidebarProps {
  isOpen: boolean;
  onDragStart: (payload: SkillDropPayload) => void;
}

export function SkillSidebar({ isOpen, onDragStart }: SkillSidebarProps) {
  const { t } = useModuleTranslation('playbook');
  const [skills, setSkills] = useState<SkillWithState[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    async function fetchSkills() {
      setLoading(true);
      try {
        const activeSkills = await getActiveSkills();
        if (!cancelled) {
          setSkills(activeSkills.map((skill) => ({ ...skill, expanded: false })));
        }
      } catch (error) {
        console.error('Failed to fetch skills:', error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchSkills();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const filteredSkills = useMemo(() => {
    if (!search.trim()) {
      return skills;
    }

    const normalizedSearch = search.trim().toLowerCase();
    return skills.filter((skill) => (
      skill.name.toLowerCase().includes(normalizedSearch)
      || skill.description.toLowerCase().includes(normalizedSearch)
      || String(skill.categoryName || '').toLowerCase().includes(normalizedSearch)
    ));
  }, [search, skills]);

  if (!isOpen) {
    return null;
  }

  return (
    <ResizablePanel
      storageKey="ys_skill_sidebar_width"
      defaultWidth={256}
      minWidth={180}
      maxWidthRatio={0.35}
      handlePosition="right"
      className="border-l bg-background"
    >
      <div className="border-b p-3">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t('skills.title')}</span>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t('skills.searchPlaceholder')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>
      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            {search ? t('skills.emptySearch') : t('skills.empty')}
          </div>
        ) : (
          <div className="space-y-1 p-2">
            {filteredSkills.map((skill) => (
              <SkillCard key={skill.id} skill={skill} onToggleExpand={() => {
                setSkills((prev) => prev.map((item) => (
                  item.id === skill.id ? { ...item, expanded: !item.expanded } : item
                )));
              }} onDragStart={onDragStart} />
            ))}
          </div>
        )}
      </ScrollArea>
    </ResizablePanel>
  );
}

function SkillCard({
  skill,
  onToggleExpand,
  onDragStart,
}: {
  skill: SkillWithState;
  onToggleExpand: () => void;
  onDragStart: (payload: SkillDropPayload) => void;
}) {
  const startDrag = (event: React.DragEvent) => {
    const payload: SkillDropPayload = {
      type: 'skill',
      skillId: skill.id,
      skillName: skill.name,
    };
    event.dataTransfer.setData('application/json', JSON.stringify(payload));
    event.dataTransfer.effectAllowed = 'copy';
    onDragStart(payload);
  };

  return (
    <Collapsible open={skill.expanded} onOpenChange={onToggleExpand}>
      <CollapsibleTrigger asChild>
        <div
          className={cn(
            'flex cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/50',
          )}
          draggable
          onDragStart={startDrag}
        >
          <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', skill.expanded && 'rotate-90')} />
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <OverflowTooltip text={skill.name} />
          {skill.categoryName ? (
            <Badge variant="secondary" className="ml-auto px-1.5 py-0 text-[10px]">
              {skill.categoryName}
            </Badge>
          ) : null}
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="ml-7 mt-0.5 rounded px-2 py-1 text-xs text-muted-foreground">
          {skill.description || skill.name}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
