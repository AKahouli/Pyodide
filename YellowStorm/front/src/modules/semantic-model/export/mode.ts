import { SVG_NODE_LIMIT, type ExportMode } from './types';

/** The drawing a graph of this size opens on: the vector one while it moves smoothly, WebGL beyond. */
export const defaultExportMode = (records: number): ExportMode => (records > SVG_NODE_LIMIT ? 'sigma' : 'svg');
export const isModeAllowed = (mode: ExportMode, records: number) => mode !== 'svg' || records <= SVG_NODE_LIMIT;
