import { useStore } from 'zustand';
import { devtools } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';
import type { DetailedViewActions, DetailedViewState } from '@openuidev/react-headless';
import { useFileViewerStore } from '@/modules/file-viewer/store';

/**
 * The side panel that shows a report. The report chip lives in the answer (inside the lazy OpenUI chunk),
 * the panel in the page layout, so they meet in this store.
 *
 * Its shape is the detailed-view store of `@openuidev/react-headless`, which the thesys report reads
 * through `DetailedViewContext` (ReportBlock provides this store there): the chip opens a view by id,
 * and the report content is portaled into the node the panel registers. Only types are imported from
 * react-headless, so the library stays out of the main chunk.
 */
export interface ReportPanelState extends DetailedViewState, DetailedViewActions {
  _detailedViewPanelNode: HTMLElement | null;
  _setDetailedViewPanelNode: (node: HTMLElement | null) => void;
}

export const initialState = { activeDetailedViewId: null, _detailedViewPanelNode: null } satisfies Pick<ReportPanelState, 'activeDetailedViewId' | '_detailedViewPanelNode'>;

/** Both panels sit on the right of the conversation: opening one closes the other (see ReportPanelSidebar for the reverse). */
function closeFileViewerSidebar(): void {
  const viewer = useFileViewerStore.getState();
  if (viewer.mode !== 'closed' && viewer.displayMode === 'sidebar') viewer.closeViewer();
}

export const reportPanelStore = createStore<ReportPanelState>()(devtools((set) => ({
  ...initialState,
  setActiveDetailedView: (id) => {
    if (id !== null) closeFileViewerSidebar();
    set({ activeDetailedViewId: id });
  },
  reset: () => set({ activeDetailedViewId: null }),
  _setDetailedViewPanelNode: (node) => set({ _detailedViewPanelNode: node }),
}), { name: 'conversation-report-panel-store' }));

export const useReportPanelActive = () => useStore(reportPanelStore, (state) => state.activeDetailedViewId !== null);
