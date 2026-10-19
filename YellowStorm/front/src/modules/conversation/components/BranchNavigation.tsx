import { memo } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  const setActiveBranch = useConversationStore((s) => s.setActiveBranch);
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useModuleTranslation('conversation');

  if (branches.length <= 1) return null;

  const currentIndex = branches.findIndex((b) => b.id === activeBranchId);
  const display = `${currentIndex + 1} / ${branches.length}`;
  const selectBranch = (answerId: string | undefined) => {
    if (!answerId || !branches.some(branch => branch.id === answerId)) return;
    setActiveBranch(userMessageId, answerId);
    const next = new URLSearchParams(searchParams);
    next.set('message', answerId);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5"
        onClick={() => selectBranch(branches[currentIndex - 1]?.id)}
        disabled={currentIndex <= 0}
        aria-label={t('branchNavigation.previous')}
      >
        <ChevronLeft className="h-3 w-3" />
      </Button>
      <span className="min-w-[3ch] text-center tabular-nums">{display}</span>
      <select
        aria-label={t('branchNavigation.history')}
        value={currentIndex < 0 ? '' : activeBranchId}
        onChange={event => selectBranch(event.target.value)}
        className="h-7 max-w-64 rounded-md border border-input bg-background px-2 text-xs text-foreground"
      >
        {currentIndex < 0 && <option value="" disabled>{t('branchNavigation.history')}</option>}
        {branches.map((branch, index) => {
          const date = new Date(branch.createdAt);
          return <option key={branch.id} value={branch.id}>
            {t('branchNavigation.version', { number: index + 1 })}
            {Number.isNaN(date.getTime()) ? '' : ` · ${date.toLocaleString()}`}
            {branch.id === activeBranchId ? ` · ${t('branchNavigation.current')}` : ''}
          </option>;
        })}
      </select>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5"
        onClick={() => selectBranch(branches[currentIndex + 1]?.id)}
        disabled={currentIndex < 0 || currentIndex >= branches.length - 1}
        aria-label={t('branchNavigation.next')}
      >
        <ChevronRight className="h-3 w-3" />
      </Button>
    </div>
  );
});
