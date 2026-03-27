import { memo } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useConversationStore } from '../store';
import type { Message } from '../types';
import { useModuleTranslation } from '@/modules/localization';

interface BranchNavigationProps {
  userMessageId: string;
  branches: Message[];
  activeBranchId: string;
}

export const BranchNavigation = memo(function BranchNavigation({
  userMessageId,
  branches,
  activeBranchId,
}: BranchNavigationProps) {
  const navigateBranch = useConversationStore((s) => s.navigateBranch);
  const { t } = useModuleTranslation('conversation');

  if (branches.length <= 1) return null;

  const currentIndex = branches.findIndex((b) => b.id === activeBranchId);
  const display = `${currentIndex + 1} / ${branches.length}`;

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5"
        onClick={() => navigateBranch(userMessageId, 'prev')}
        disabled={currentIndex <= 0}
        aria-label={t('branchNavigation.previous')}
      >
        <ChevronLeft className="h-3 w-3" />
      </Button>
      <span className="min-w-[3ch] text-center tabular-nums">{display}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5"
        onClick={() => navigateBranch(userMessageId, 'next')}
        disabled={currentIndex >= branches.length - 1}
        aria-label={t('branchNavigation.next')}
      >
        <ChevronRight className="h-3 w-3" />
      </Button>
    </div>
  );
});
