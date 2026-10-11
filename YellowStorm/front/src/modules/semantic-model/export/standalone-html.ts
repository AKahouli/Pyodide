import coreSource from './runtime/core.js?raw';
import panelSource from './runtime/panel.js?raw';
import uiSource from './runtime/ui.js?raw';
import svgRenderer from './runtime/renderer-svg.js?raw';
import sigmaRenderer from './runtime/renderer-sigma.js?raw';
import { EXPORT_STYLES } from './runtime/styles';
import sigmaLibrary from '/node_modules/sigma/dist/sigma.min.js?raw';
import graphologyLibrary from '/node_modules/graphology/dist/graphology.umd.min.js?raw';
import { isModeAllowed } from './mode';
import { SVG_NODE_LIMIT, type StandaloneGraphInput } from './types';

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
/** Data inside a script tag can never close it, nor open a comment: every `<` is written as a unicode escape. */
const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
/** Inlined code must never close its own tag either; source maps point at files the reader does not have. */
const inlineScript = (source: string) => source.replace(/<\/script/gi, '<\\/script').replace(/\/\/# sourceMappingURL=.*$/gm, '');

/**
 * One HTML file holding a view of the data graph and everything that draws it: no network, no sign-in, no server. Records
 * are placed as given, so the file shows what the app showed. The data travels as JSON in an inert script tag and the
 * runtime only ever writes it into the page as text.
 */
export function buildStandaloneGraphHtml({ mode, nodes, edges, concepts, meta }: StandaloneGraphInput): string {
  if (!isModeAllowed(mode, nodes.length)) throw new Error(`The vector drawing holds at most ${SVG_NODE_LIMIT} records, not ${nodes.length}`);
  const conceptAt = new Map(concepts.map((concept, position) => [concept.key, position]));
  const recordAt = new Map(nodes.map((node, position) => [node.id, position]));
  const relations = [...new Set(edges.map((edge) => edge.label))];
  const data = {
    mode,
    meta: { language: meta.language },
    t: meta.strings,
    concepts: concepts.map(({ label, color, fields }) => ({ label, color, fields })),
    relations,
    // Per record: name, concept, x, y, size, positions of missing fields, values, id.
    nodes: nodes.map((node) => [node.label, conceptAt.get(node.concept), node.x, node.y, node.size, node.missing, node.values, node.id]),
    edges: edges.flatMap((edge) => {
      const [from, to] = [recordAt.get(edge.source), recordAt.get(edge.target)];
      return from === undefined || to === undefined ? [] : [[from, to, relations.indexOf(edge.label)]];
    }),
  };
  const libraries = mode === 'sigma' ? [graphologyLibrary, sigmaLibrary] : [];
  const runtime = [coreSource, panelSource, mode === 'sigma' ? sigmaRenderer : svgRenderer, uiSource].join('\n');

  return `<!doctype html>
<html lang="${escapeHtml(meta.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(meta.title)}</title>
<style>${EXPORT_STYLES}</style>
</head>
<body>
<header class="top">
  <div class="heading"><h1>${escapeHtml(meta.title)}</h1><p class="sub">${escapeHtml(meta.subtitle)}</p></div>
  <div class="search"><input id="search" type="search" autocomplete="off"><ul id="results" role="listbox" hidden></ul></div>
  <div class="tools"><button id="fit" type="button"></button><button id="link-names" type="button" aria-pressed="false"></button></div>
  <nav id="legend" class="legend"></nav>
</header>
<main>
  <div id="graph"></div>
  <div id="selection" hidden></div>
  <p id="status"><span id="showing" role="status"></span><span id="ring-legend"><i class="ring"></i><span id="missing-legend"></span></span></p>
  <aside id="panel" hidden></aside>
  <p id="loading">${escapeHtml(meta.strings.loading)}</p>
</main>
<script type="application/json" id="graph-data">${safeJson(data)}</script>
${libraries.map((source) => `<script>${inlineScript(source)}</script>`).join('\n')}
<script>(function () {
'use strict';
${inlineScript(runtime)}
})();</script>
</body>
</html>
`;
}
