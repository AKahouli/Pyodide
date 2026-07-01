import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { Button } from '@/components/ui/button';
import { useBoard, useStream } from '../query/hooks';
import { useWorkyBoard } from '../store';
import { useWorkyUiStore } from '../uiStore';
import { BudgetControl } from './BudgetControl';
import { ChatMessageThread } from './ChatMessageThread';
import { HumanTaskPanel } from './HumanTaskPanel';
import { MemoryProposalCard } from './MemoryProposalCard';
import { OrchestratorStatusHeader } from './OrchestratorStatusHeader';
import { PromptBar } from './PromptBar';
import { StreamModelsControl } from './StreamModelsControl';
import { cn } from '@/lib/utils';
import type { WorkyStream, WorkyTask } from '../types';

interface OrchestratorPanelProps {
  streamId: string;
  onWhatsAppClick?: () => void;
  whatsappConnected?: boolean;
}

type OrchestratorTab = 'chat' | 'details';

const ORCHESTRATOR_TABS: OrchestratorTab[] = ['chat', 'details'];

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    setMatches(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export function OrchestratorPanel({
  streamId,
  onWhatsAppClick,
  whatsappConnected,
}: OrchestratorPanelProps): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const [activeTab, setActiveTab] = useState<OrchestratorTab>('chat');
  const boardQuery = useBoard(streamId);
  const streamQuery = useStream(streamId);
  const board = useWorkyBoard();
  const open = useWorkyUiStore((s) => s.orchestratorOpen);
  const setOpen = useWorkyUiStore((s) => s.setOrchestratorOpen);
  // On lg+ the panel is always visible inline so it must never be
  // hidden from assistive technology. Below lg it acts as a
  // slide-over that the user opens via a toggle, so we mirror the
  // open state to `aria-hidden` only in that case.
  const isLgUp = useMediaQuery('(min-width: 1024px)');
  const inertForScreenReaders = !isLgUp && !open;

  // Move focus out of the panel before the slide-over closes so
  // assistive technology does not see focus inside an `aria-hidden`
  // subtree.
  const handleClose = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setOpen(false);
  };

  const humanTasks = useMemo(
    () => (boardQuery.data ? Object.values(boardQuery.data.lanes).flat() : []),
    [boardQuery.data],
  );

  useEffect(() => {
    setActiveTab('chat');
  }, [streamId]);

  return (
    <aside
      data-testid='worky-orchestrator-panel'
      data-open={open}
      aria-label={t('orchestrator.title')}
      aria-hidden={inertForScreenReaders || undefined}
      className={cn(
        'flex h-full w-[360px] shrink-0 flex-col gap-3 overflow-hidden border-l border-border/60 bg-background/95 p-3',
        // On lg+ the panel is always visible inline; below lg it
        // becomes a fixed slide-over that the user opens via a toggle
        // button rendered by `WorkyStreamPage`.
        'lg:relative lg:translate-x-0 lg:bg-background/30',
        open
          ? 'fixed inset-y-0 right-0 z-30 translate-x-0 shadow-xl'
          : 'pointer-events-none fixed inset-y-0 right-0 z-30 translate-x-full lg:pointer-events-auto lg:translate-x-0',
      )}
    >
      <div className='flex shrink-0 items-center justify-between lg:hidden'>
        <span className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
          {t('orchestrator.title')}
        </span>
        <Button
          type='button'
          size='icon'
          variant='ghost'
          onClick={handleClose}
          aria-label={t('orchestrator.close')}
          data-testid='worky-orchestrator-close'
        >
          <X className='h-4 w-4' />
        </Button>
      </div>
      <div className='flex shrink-0 flex-col gap-3'>
        <OrchestratorStatusHeader stream={streamQuery.data} board={board} />
        <OrchestratorTabs activeTab={activeTab} onChange={setActiveTab} />
      </div>
      {activeTab === 'chat' ? (
        <ChatPanel
          streamId={streamId}
          status={streamQuery.data?.status}
          onWhatsAppClick={onWhatsAppClick}
          whatsappConnected={whatsappConnected}
        />
      ) : (
        <DetailsPanel streamId={streamId} stream={streamQuery.data} humanTasks={humanTasks} />
      )}
    </aside>
  );
}

interface OrchestratorTabsProps {
  activeTab: OrchestratorTab;
  onChange: (tab: OrchestratorTab) => void;
}

function OrchestratorTabs({ activeTab, onChange }: OrchestratorTabsProps): JSX.Element {
  const { t } = useModuleTranslation('worky');

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = ORCHESTRATOR_TABS.indexOf(activeTab);
    const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (!direction) return;
    event.preventDefault();
    const nextIndex = (currentIndex + direction + ORCHESTRATOR_TABS.length) % ORCHESTRATOR_TABS.length;
    const nextTab = ORCHESTRATOR_TABS[nextIndex];
    onChange(nextTab);
    document.getElementById(`worky-orchestrator-${nextTab}-tab`)?.focus();
  };

  return (
    <div role='tablist' aria-label={t('orchestrator.tabs.label')} className='grid grid-cols-2 rounded-md border border-border/60 bg-muted/20 p-1'>
      {ORCHESTRATOR_TABS.map((tab) => (
        <button
          key={tab}
          id={`worky-orchestrator-${tab}-tab`}
          type='button'
          role='tab'
          aria-selected={activeTab === tab}
          aria-controls={`worky-orchestrator-${tab}`}
          tabIndex={activeTab === tab ? 0 : -1}
          className={cn('rounded px-2 py-1.5 text-xs font-medium transition-colors', activeTab === tab ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
          onClick={() => onChange(tab)}
          onKeyDown={handleKeyDown}
        >
          {t(`orchestrator.tabs.${tab}`)}
        </button>
      ))}
    </div>
  );
}

function ChatPanel({
  streamId,
  status,
  onWhatsAppClick,
  whatsappConnected,
}: {
  streamId: string;
  status?: WorkyStream['status'];
  onWhatsAppClick?: () => void;
  whatsappConnected?: boolean;
}): JSX.Element {
  return (
    <div id='worky-orchestrator-chat' role='tabpanel' aria-labelledby='worky-orchestrator-chat-tab' className='grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-2 overflow-hidden'>
      <ChatMessageThread streamId={streamId} />
      <div className='shrink-0'>
        <PromptBar
          key={streamId}
          streamId={streamId}
          status={status}
          onWhatsAppClick={onWhatsAppClick}
          whatsappConnected={whatsappConnected}
        />
      </div>
    </div>
  );
}

function DetailsPanel({ streamId, stream, humanTasks }: { streamId: string; stream?: WorkyStream; humanTasks: WorkyTask[] }): JSX.Element {
  return (
    <div id='worky-orchestrator-details' role='tabpanel' aria-labelledby='worky-orchestrator-details-tab' className='flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1'>
      {stream ? <StreamModelsControl stream={stream} /> : null}
      <BudgetControl streamId={streamId} />
      <HumanTaskPanel streamId={streamId} tasks={humanTasks} />
      <MemoryProposalCard />
    </div>
  );
}
