import d3Dispatch from '/node_modules/d3-dispatch/dist/d3-dispatch.min.js?raw';
import d3Timer from '/node_modules/d3-timer/dist/d3-timer.min.js?raw';
import d3Quadtree from '/node_modules/d3-quadtree/dist/d3-quadtree.min.js?raw';
import d3Force from '/node_modules/d3-force/dist/d3-force.min.js?raw';
import d3Selection from '/node_modules/d3-selection/dist/d3-selection.min.js?raw';
import d3Color from '/node_modules/d3-color/dist/d3-color.min.js?raw';
import d3Interpolate from '/node_modules/d3-interpolate/dist/d3-interpolate.min.js?raw';
import d3Ease from '/node_modules/d3-ease/dist/d3-ease.min.js?raw';
import d3Transition from '/node_modules/d3-transition/dist/d3-transition.min.js?raw';
import d3Drag from '/node_modules/d3-drag/dist/d3-drag.min.js?raw';
import d3Zoom from '/node_modules/d3-zoom/dist/d3-zoom.min.js?raw';
import viewerSource from './export-viewer.js?raw';
import type { GraphExportChoice, GraphExportContent } from '../../types';
import { isMissing, type GraphIndex } from './graph-analytics';

/** The d3 modules the viewer uses, in the order they depend on each other. */
const D3_SOURCES = [d3Dispatch, d3Timer, d3Quadtree, d3Force, d3Selection, d3Color, d3Interpolate, d3Ease, d3Transition, d3Drag, d3Zoom];

/** What the people reading the file see, in the language of whoever exported it. */
export type ExportStrings = Record<
  'search' | 'searchPlaceholder' | 'noMatch' | 'values' | 'noValues' | 'linked' | 'noLinks' | 'missingCount' | 'missingValue' | 'showMore' | 'showLess'
  | 'close' | 'centerOn' | 'fit' | 'linkNames' | 'neighboursOnly' | 'showAll' | 'andMore' | 'recordSummary' | 'yes' | 'no' | 'loading' | 'cannotOpen'
  | 'tooManyToDraw' | 'drawAll' | 'showing',
  string
>;

export interface ExportMeta {
  title: string;
  subtitle: string;
  language: string;
  strings: ExportStrings;
  colorOf: (concept: string) => string;
  /** Field choices per concept key: fields left out are not in the file at all. */
  choices: Record<string, Record<string, GraphExportChoice>>;
  /** Above this many records the file opens on one bubble per concept, as in the app. */
  drawLimit: number;
  /** Past this, even "draw all" is not offered. */
  maxDraw: number;
  onProgress?: (step: 'packing') => void;
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
/** Inlined scripts must never close their own tag. */
const inlineScript = (source: string) => source.replace(/<\/script/gi, '<\\/script').replace(/\/\/# sourceMappingURL=.*$/gm, '');

async function gzipBase64(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(binary);
}

/**
 * A single HTML file holding the data graph and a viewer for it — search, legend, record values and linked records —
 * that opens offline in any recent browser, without the app or a sign-in.
 */
export async function buildExportHtml(content: GraphExportContent, index: GraphIndex, meta: ExportMeta): Promise<Blob> {
  meta.onProgress?.('packing');

  // Concepts by the id the server uses, named and coloured as in the app; only the fields that were kept.
  const conceptIds = [...new Set(content.records.map((record) => record.c))];
  const conceptOf = (id: string) => {
    const sample = content.records.find((record) => record.c === id);
    return sample ? index.byId.get(sample.id) : undefined;
  };
  const concepts = conceptIds.map((id) => {
    const sample = conceptOf(id);
    const key = sample?.concept ?? id;
    const fields = (sample?.fields ?? []).filter((field) => meta.choices[key]?.[field.key] !== 'exclude');
    return { id, key, label: sample?.conceptLabel ?? id, color: meta.colorOf(key), fields };
  });
  const conceptIndex = new Map(concepts.map((concept, position) => [concept.id, position]));
  const relationLabels = new Map(index.links.map((link) => [link.relation, link.label]));
  const relations = [...new Set(content.links.map((link) => link.r))];
  const relationIndex = new Map(relations.map((relation, position) => [relation, position]));
  const recordIndex = new Map(content.records.map((record, position) => [record.id, position]));

  const data = {
    meta: { title: meta.title, subtitle: meta.subtitle, drawLimit: meta.drawLimit, maxDraw: meta.maxDraw },
    t: meta.strings,
    concepts: concepts.map((concept) => ({ label: concept.label, color: concept.color, fields: concept.fields.map((field) => field.label) })),
    relations: relations.map((relation) => relationLabels.get(relation) ?? relation.replaceAll('_', ' ')),
    records: content.records.map((record) => {
      const concept = concepts[conceptIndex.get(record.c)!];
      const values = concept.fields.map((field) => (isMissing(record.v[field.key]) ? null : record.v[field.key]));
      return [record.l, conceptIndex.get(record.c), values, index.byId.get(record.id)?.missing ?? 0];
    }),
    links: content.links.filter((link) => recordIndex.has(link.s) && recordIndex.has(link.t))
      .map((link) => [recordIndex.get(link.s), recordIndex.get(link.t), relationIndex.get(link.r)]),
  };
  const packed = await gzipBase64(JSON.stringify(data));

  const html = `<!doctype html>
<html lang="${escapeHtml(meta.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(meta.title)}</title>
<style>${EXPORT_CSS}</style>
</head>
<body>
<header class="top">
  <div class="heading"><h1 id="title">${escapeHtml(meta.title)}</h1><p id="subtitle" class="sub">${escapeHtml(meta.subtitle)}</p></div>
  <div class="search"><input id="search" type="search" autocomplete="off"><ul id="results" role="listbox" hidden></ul></div>
  <div class="tools"><button id="fit" type="button"></button><button id="link-names" type="button" aria-pressed="false"></button></div>
  <nav id="legend" class="legend"></nav>
</header>
<main>
  <div id="graph"></div>
  <div id="note" role="note" hidden></div>
  <p id="showing" role="status"></p>
  <aside id="panel" hidden></aside>
  <p id="loading" data-error="${escapeHtml(meta.strings.cannotOpen)}">${escapeHtml(meta.strings.loading)}</p>
</main>
<script type="application/octet-stream" id="graph-data">${packed}</script>
${D3_SOURCES.map((source) => `<script>${inlineScript(source)}</script>`).join('\n')}
<script>${inlineScript(viewerSource)}</script>
</body>
</html>
`;
  return new Blob([html], { type: 'text/html;charset=utf-8' });
}

const EXPORT_CSS = `
:root { color-scheme: dark; --bg: #0f0f1a; --panel: #15152a; --line: rgba(255,255,255,.1); --text: #f3f4f6; --muted: rgba(255,255,255,.5); --accent: #7dd3fc; }
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--text); font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; display: flex; flex-direction: column; }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
.top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 10px 16px; border-bottom: 1px solid var(--line); }
.heading { min-width: 0; }
h1 { margin: 0; font-size: 15px; }
.sub { margin: 0; color: var(--muted); font-size: 12px; }
.search { position: relative; width: 300px; max-width: 100%; }
.search input { width: 100%; height: 32px; padding: 0 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,.15); background: rgba(255,255,255,.05); color: var(--text); }
#results { position: absolute; z-index: 5; left: 0; right: 0; top: 36px; margin: 0; padding: 4px 0; list-style: none; background: #1a1a2b; border: 1px solid var(--line); border-radius: 6px; max-height: 320px; overflow: auto; }
#results button { display: flex; width: 100%; gap: 8px; align-items: center; padding: 6px 12px; text-align: left; }
#results button:hover { background: rgba(255,255,255,.08); }
#results .empty { padding: 8px 12px; color: var(--muted); font-size: 12px; }
.grow { flex: 1; min-width: 0; }
.name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tools { display: flex; gap: 4px; margin-left: auto; }
.tools button { padding: 5px 10px; border-radius: 6px; border: 1px solid var(--line); font-size: 12px; color: rgba(255,255,255,.75); }
.tools button[aria-pressed="true"] { background: rgba(255,255,255,.15); color: #fff; }
.legend { flex-basis: 100%; display: flex; flex-wrap: wrap; gap: 4px; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: 999px; font-size: 12px; color: rgba(255,255,255,.75); white-space: nowrap; }
.chip:hover { background: rgba(255,255,255,.08); }
.chip.off { color: rgba(255,255,255,.3); text-decoration: line-through; }
.count { color: var(--muted); font-variant-numeric: tabular-nums; }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; flex: none; }
.link { color: var(--accent); text-align: left; }
.link:hover { text-decoration: underline; }
.small { font-size: 11px; }
main { flex: 1; display: flex; min-height: 0; position: relative; }
#graph { flex: 1; min-width: 0; position: relative; }
#graph svg { display: block; width: 100%; height: 100%; font-family: system-ui, sans-serif; }
#note { position: absolute; left: 50%; top: 16px; transform: translateX(-50%); width: min(36rem, calc(100% - 24px)); padding: 10px 14px; border: 1px solid rgba(125,211,252,.2); border-radius: 8px; background: rgba(21,21,42,.95); font-size: 12px; color: rgba(255,255,255,.75); }
#note p { margin: 0 0 6px; }
#showing { position: absolute; left: 12px; bottom: 8px; margin: 0; font-size: 12px; color: var(--muted); pointer-events: none; }
#loading { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; color: var(--muted); }
#panel { width: min(420px, 100%); display: flex; flex-direction: column; border-left: 1px solid var(--line); background: var(--panel); }
#panel header { display: flex; gap: 8px; align-items: flex-start; padding: 12px 16px; border-bottom: 1px solid var(--line); }
#panel h2 { margin: 6px 0 2px; font-size: 16px; word-break: break-word; }
.badge { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 999px; font-size: 11px; }
.icon { padding: 4px 6px; border-radius: 4px; color: var(--muted); }
.icon:hover { background: rgba(255,255,255,.1); color: #fff; }
.scroll { flex: 1; overflow: auto; padding: 12px 16px 32px; }
h3 { margin: 16px 0 6px; font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
dl { margin: 0; }
.row { padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,.05); }
dt { font-size: 11px; color: var(--muted); }
dd { margin: 0; white-space: pre-wrap; word-break: break-word; }
dd.clamp { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
dd.missing { color: rgba(251,191,36,.7); font-style: italic; }
details summary { cursor: pointer; font-size: 12px; color: rgba(255,255,255,.75); padding: 3px 0; }
.groups, .groups ul { list-style: none; margin: 0; padding: 0; }
.groups ul { margin-left: 14px; padding-left: 8px; border-left: 1px solid var(--line); }
.groups ul .link { font-size: 12px; padding: 1px 0; }
.toggle { display: flex; gap: 6px; align-items: center; font-size: 12px; color: rgba(255,255,255,.75); }
@media (max-width: 720px) { #panel { position: absolute; inset: 0; width: 100%; } .tools { margin-left: 0; } }
`;
