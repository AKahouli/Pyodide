import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { HelpCircle, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { useConversationStore, useDisplayMessages } from '../../store';
import { useConversationUiStore } from '../../uiStore';
import { buildOutlineGroups, OUTLINE_LISTED_LEVELS, type OutlineGroup } from './outline-groups';

/** Headings at these levels are listed; deeper levels keep anchor ids only. */

/** Case-insensitive text match across a group's question and listed headings. */
function groupMatchesQuery(group: OutlineGroup, query: string): boolean {
  if (group.questionText && group.questionText.toLowerCase().includes(query)) return true;
  return group.items.some((item) => OUTLINE_LISTED_LEVELS.has(item.level) && item.text && item.text.toLowerCase().includes(query));
}

function OutlineGroupSection({ group, activeAnchorId, onSelect, questionAriaLabel, query }: Readonly<{ group: OutlineGroup; activeAnchorId: string | null; onSelect: (anchorId: string) => void; questionAriaLabel: string; query: string }>) {
  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = (text: string) => !normalizedQuery || text.toLowerCase().includes(normalizedQuery);
  const items = group.items.filter((item) => OUTLINE_LISTED_LEVELS.has(item.level) && item.text && matchesQuery(item.text));
  const showQuestion = Boolean(group.questionId && group.questionText && matchesQuery(group.questionText));
  if (items.length === 0 && !showQuestion) return null;
  return (
    <div className='mb-3' data-outline-group>
      {showQuestion && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type='button'
              onClick={() => onSelect(`message-${group.questionId}`)}
              aria-label={`${questionAriaLabel}: ${group.questionText}`}
              className='mb-1 flex w-full items-start gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium text-foreground/90 transition-colors hover:bg-muted/60'
            >
              <HelpCircle className='mt-0.5 size-3.5 shrink-0 text-muted-foreground' aria-hidden='true' />
              <span className='line-clamp-2 min-w-0'>{group.questionText}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side='right' className='max-w-80'>
            <p className='whitespace-pre-wrap'>{group.questionText}</p>
          </TooltipContent>
        </Tooltip>
      )}
      {items.length > 0 && (
        <ul className='space-y-0.5 border-l border-border/60'>
          {items.map((item) => {
            const active = activeAnchorId === item.id;
            return (
              <li key={item.id}>
                <button
                  type='button'
                  data-active={active || undefined}
                  title={item.text}
                  onClick={() => onSelect(item.id)}
                  className={cn('w-full truncate rounded-r-md border-l-2 py-1 pr-2 text-left text-xs transition-colors', active ? 'border-l-primary bg-muted/50 font-medium text-foreground' : 'border-l-transparent text-muted-foreground hover:text-foreground')}
                  style={{ paddingLeft: `${(item.level - 1) * 10 + 8}px` }}
                >
                  {item.text}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Collapsible left rail listing conversation headings (h1–h3) grouped by the
 * user prompt that produced them. Always mounted and visible next to the
 * conversation thread at every viewport width — with an empty-state hint
 * until headings exist.
 */
export function ConversationOutlineRail() {
  const { t } = useModuleTranslation('conversation');
  const messages = useDisplayMessages();
  const isStreaming = useConversationStore((s) => s.isStreaming);
  const streamingMessageId = useConversationStore((s) => s.streamingMessageId);
  const headingsByMessageId = useConversationUiStore(useShallow((s) => s.outlineHeadingsByMessageId));
  const activeAnchorId = useConversationUiStore((s) => s.activeOutlineAnchorId);
  const collapsed = useConversationUiStore((s) => s.outlineCollapsed);
  const setOutlineCollapsed = useConversationUiStore((s) => s.setOutlineCollapsed);
  const requestOutlineScroll = useConversationUiStore((s) => s.requestOutlineScroll);
  const [searchQuery, setSearchQuery] = useState('');

  const groups = useMemo(
    () => buildOutlineGroups(messages, headingsByMessageId, streamingMessageId, isStreaming),
    [messages, headingsByMessageId, streamingMessageId, isStreaming],
  );
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleGroups = useMemo(
    () => (normalizedQuery ? groups.filter((group) => groupMatchesQuery(group, normalizedQuery)) : groups),
    [groups, normalizedQuery],
  );

  if (collapsed) {
    return (
      <div data-outline-rail='collapsed' className='flex shrink-0 flex-col items-center border-r border-border/50 py-3'>
        <Button variant='ghost' size='icon' className='size-8' aria-label={t('outline.expand')} title={t('outline.expand')} onClick={() => setOutlineCollapsed(false)}>
          <PanelLeftOpen className='size-4' />
        </Button>
      </div>
    );
  }

  return (
    <nav data-outline-rail='expanded' aria-label={t('outline.title')} className='flex w-60 shrink-0 flex-col border-r border-border/50'>
      <div className='flex items-center justify-between gap-2 px-3 pb-1 pt-3'>
        <span className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{t('outline.title')}</span>
        <Button variant='ghost' size='icon' className='size-7' aria-label={t('outline.collapse')} title={t('outline.collapse')} onClick={() => setOutlineCollapsed(true)}>
          <PanelLeftClose className='size-4' />
        </Button>
      </div>
      {groups.length > 0 && (
        <div className='relative px-3 pb-2'>
          <Search className='pointer-events-none absolute left-5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground' aria-hidden='true' />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t('outline.searchPlaceholder')}
            aria-label={t('outline.searchPlaceholder')}
            className='h-8 pl-8 text-xs'
          />
        </div>
      )}
      <TooltipProvider delayDuration={300}>
        <div className='custom-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3'>
          {groups.length === 0
            ? <p data-outline-empty className='px-2 pt-1 text-xs leading-relaxed text-muted-foreground'>{t('outline.empty')}</p>
            : visibleGroups.length === 0
              ? <p data-outline-empty className='px-2 pt-1 text-xs leading-relaxed text-muted-foreground'>{t('outline.noResults')}</p>
              : visibleGroups.map((group) => (
              <OutlineGroupSection key={group.key} group={group} activeAnchorId={activeAnchorId} onSelect={requestOutlineScroll} questionAriaLabel={t('outline.jumpToQuestion')} query={searchQuery} />
            ))}
        </div>
      </TooltipProvider>
    </nav>
  );
}
