import { create } from 'zustand';

/** A record of a semantic model an answer cited: what the citation carries to name it and open it again. */
export interface RecordCitationTarget {
  modelId: string;
  modelName: string;
  data: 'published' | 'draft';
  dataRevisionId: string;
  entityId: string;
  concept: string;
  name: string;
  keyFields: Record<string, string>;
  /** The field the quote was taken from, when the record was found by a passage of it. */
  field?: string;
  quote?: string;
}

/** The model graph opened from a cited record, centred over the chat. */
export interface RecordGraphTarget {
  modelId: string;
  entityId: string;
}

interface RecordCitationState {
  target: RecordCitationTarget | null;
  graph: RecordGraphTarget | null;
  open: (target: RecordCitationTarget) => void;
  close: () => void;
  openGraph: (graph: RecordGraphTarget) => void;
  closeGraph: () => void;
}

/** The cited record shown in the record drawer (one at a time, from any conversation). */
export const useRecordCitationStore = create<RecordCitationState>((set) => ({
  target: null,
  graph: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
  // The drawer gives way to the graph: one is shown at a time.
  openGraph: (graph) => set({ target: null, graph }),
  closeGraph: () => set({ graph: null }),
}));

export const openRecordCitation = (target: RecordCitationTarget) => useRecordCitationStore.getState().open(target);
