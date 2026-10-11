import { buildExportView, exportNodeSize, type ViewSource } from './build-view';
import { layoutRecords } from './layout';
import { buildStandaloneGraphHtml } from './standalone-html';
import type { ExportMeta, ExportMode } from './types';

export type ExportStep = 'layout' | 'packing';

export interface ViewExportRequest extends Omit<ViewSource, 'positions'> {
  mode: ExportMode;
  meta: ExportMeta;
  /** Where the graph view has laid the records it draws, if it draws them. */
  canvasPositions?: Map<string, { x: number; y: number }>;
  onStep?: (step: ExportStep) => void;
}

const covers = (positions: Map<string, unknown> | undefined, ids: Set<string>) => Boolean(positions) && [...ids].every((id) => positions!.has(id));

/**
 * The records in the view as one standalone HTML file. Records are placed where the graph view has them; when it does not
 * draw them (one bubble per concept, or records it has not placed) they are laid out here the same way.
 */
export async function createViewExport(request: ViewExportRequest): Promise<string> {
  const { index, ids, mode, meta, canvasPositions, onStep, ...source } = request;
  let positions = canvasPositions;
  if (!covers(positions, ids)) {
    onStep?.('layout');
    positions = await layoutRecords(
      [...ids].map((id) => ({ id, size: exportNodeSize(index, id) })),
      index.links.filter((link) => ids.has(link.source) && ids.has(link.target)),
    );
  }
  onStep?.('packing');
  return buildStandaloneGraphHtml({ mode, meta, ...buildExportView({ ...source, index, ids, positions: positions! }) });
}
