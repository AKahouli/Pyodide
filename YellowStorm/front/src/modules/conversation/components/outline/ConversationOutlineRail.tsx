import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { HelpCircle, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { useConversationStore, useDisplayMessages } from '../../store';
import { useConversationUiStore } from '../../uiStore';
import { buildOutlineGroups, OUTLINE_LISTED_LEVELS, type OutlineGroup } from './outline-groups';

/** Headings at these levels are listed; deeper levels keep anchor ids only. */

function OutlineGroupSection({ group, activeAnchorId, onSelect, questionAriaLabel }: Readonly<{ group: OutlineGroup; activeAnchorId: string | null; onSelect: (anchorId: string) => void; questionAriaLabel: string }>) {
  const items = group.items.filter((item) => OUTLINE_LISTED_LEVELS.has(item.level) && item.text);
  if (items.length === 0 && !group.questionText) return null;
  return (
    <div className='mb-3' data-outline-group>
      {group.questionId && group.questionText && (
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
 * user prompt that produced them. Renders nothing until headings exist; on
 * narrow screens it stays hidden entirely.
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

  const groups = useMemo(
    () => buildOutlineGroups(messages, headingsByMessageId, streamingMessageId, isStreaming),
    [messages, headingsByMessageId, streamingMessageId, isStreaming],
  );

  if (groups.length === 0) return null;

  if (collapsed) {
    return (
      <div data-outline-rail='collapsed' className='hidden shrink-0 flex-col items-center border-r border-border/50 py-3 xl:flex'>
        <Button variant='ghost' size='icon' className='size-8' aria-label={t('outline.expand')} title={t('outline.expand')} onClick={() => setOutlineCollapsed(false)}>
          <PanelLeftOpen className='size-4' />
        </Button>
      </div>
    );
  }

  return (
    <nav data-outline-rail='expanded' aria-label={t('outline.title')} className='hidden w-60 shrink-0 flex-col border-r border-border/50 xl:flex'>
      <div className='flex items-center justify-between gap-2 px-3 pb-1 pt-3'>
        <span className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{t('outline.title')}</span>
        <Button variant='ghost' size='icon' className='size-7' aria-label={t('outline.collapse')} title={t('outline.collapse')} onClick={() => setOutlineCollapsed(true)}>
          <PanelLeftClose className='size-4' />
        </Button>
      </div>
      <TooltipProvider delayDuration={300}>
        <div className='custom-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3'>
          {groups.map((group) => (
            <OutlineGroupSection key={group.key} group={group} activeAnchorId={activeAnchorId} onSelect={requestOutlineScroll} questionAriaLabel={t('outline.jumpToQuestion')} />
          ))}
        </div>
      </TooltipProvider>
    </nav>
  );
}
