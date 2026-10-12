/** How the file draws the graph: a vector drawing like the app's, or WebGL for graphs too large for one. */
export type ExportMode = 'svg' | 'sigma';

/** Above this many records the vector drawing no longer moves smoothly: the file is drawn with WebGL. */
export const SVG_NODE_LIMIT = 2000;

export interface ExportConcept {
  key: string;
  label: string;
  color: string;
  /** Names of the fields, in the order record values come in. */
  fields: string[];
}

export interface ExportNode {
  id: string;
  label: string;
  /** The concept's key. */
  concept: string;
  x: number;
  y: number;
  /** Radius in pixels at zoom 1, as the app draws it. */
  size: number;
  /** Positions in the concept's fields of the fields this record misses. */
  missing: number[];
  /** Values as people read them, one per field of the concept (null where missing); null when values are left out. */
  values: Array<string | null> | null;
}

export interface ExportEdge { source: string; target: string; label: string }

/** What the people reading the file see, in the language of whoever exported it. `{{name}}` marks where a number or name goes. */
export type ExportStrings = Record<
  | 'search' | 'searchPlaceholder' | 'searchResults' | 'noMatch' | 'legend' | 'hideConcept' | 'showConcept' | 'showAll' | 'fit' | 'linkNames'
  | 'showing' | 'missingLegend' | 'fields' | 'values' | 'valuesNotIncluded' | 'noAttributes' | 'missingCount' | 'missingValue' | 'showMore' | 'showLess'
  | 'linked' | 'noLinks' | 'andMore' | 'recordSummary' | 'close' | 'centerOn' | 'details' | 'clearSelection' | 'canvasLabel' | 'loading' | 'cannotOpen' | 'noWebgl',
  string
>;

export interface ExportMeta {
  /** Heading and page title: the model's name. */
  title: string;
  /** Under the heading: when it was exported, and how much it holds. */
  subtitle: string;
  language: string;
  strings: ExportStrings;
}

export interface StandaloneGraphInput {
  mode: ExportMode;
  nodes: ExportNode[];
  edges: ExportEdge[];
  concepts: ExportConcept[];
  meta: ExportMeta;
}
