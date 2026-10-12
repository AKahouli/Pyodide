// Shared by both drawings: the data, what is shown, emphasised or hidden, and small helpers. Runs inside one function
// together with panel.js, ui.js and one renderer; everything the file shows is set with textContent, never as HTML.
const DATA = JSON.parse(document.getElementById('graph-data').textContent);
const T = DATA.t;
const concepts = DATA.concepts;

const fmt = (text, values) => text.replace(/\{\{(\w+)\}\}/g, (_, key) => (values[key] === undefined ? '' : String(values[key])));
const fold = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const number = (value) => value.toLocaleString(DATA.meta.language);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function el(tag, props, kids) {
  const node = document.createElement(tag);
  for (const key in props || {}) {
    const value = props[key];
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
    else if (key === 'style') node.style.cssText = value;
    else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : value);
  }
  for (const kid of kids || []) if (kid) node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  return node;
}

const nodes = DATA.nodes.map((row, i) => ({
  i, label: row[0], c: row[1], x: row[2], y: row[3], size: row[4], missing: row[5], values: row[6], id: row[7],
  folded: fold(row[0]), foldedId: fold(row[7]),
}));
const edges = DATA.edges.map((row, k) => ({ k, s: row[0], t: row[1], r: DATA.relations[row[2]] }));
// For each record, the links touching it either way.
const adjacent = nodes.map(() => []);
for (const edge of edges) {
  adjacent[edge.s].push(edge.k);
  if (edge.t !== edge.s) adjacent[edge.t].push(edge.k);
}
const conceptCounts = concepts.map((_, c) => nodes.filter((node) => node.c === c).length);

// What is shown now. Renderers read it and draw it; the interface changes it and asks them to refresh.
const state = {
  selected: -1,
  hover: -1,
  hidden: new Set(),
  /** Records the search singles out, or null. */
  matches: null,
  /** The focused record and its neighbours, or null. */
  near: null,
  linkNames: false,
  panelOpen: false,
};

const nodeHidden = (i) => state.hidden.has(nodes[i].c);
const edgeHidden = (edge) => nodeHidden(edge.s) || nodeHidden(edge.t);
const focusIndex = () => (state.hover >= 0 ? state.hover : state.selected);
const edgeLit = (edge) => { const focus = focusIndex(); return focus >= 0 && (edge.s === focus || edge.t === focus); };

function computeNear() {
  const focus = focusIndex();
  if (focus < 0 || nodeHidden(focus)) { state.near = null; return; }
  state.near = new Set([focus]);
  for (const k of adjacent[focus]) { state.near.add(edges[k].s); state.near.add(edges[k].t); }
}

/** 0 hidden, 1 in full, less when faded behind what is singled out. */
function nodeAlpha(i) {
  if (nodeHidden(i)) return 0;
  if (state.matches) return state.matches.has(i) ? 1 : 0.15;
  if (state.near) return state.near.has(i) ? 1 : 0.3;
  return 1;
}
function edgeAlpha(edge) {
  if (edgeHidden(edge)) return 0;
  if (state.matches) return state.matches.has(edge.s) && state.matches.has(edge.t) ? 1 : 0.2;
  if (state.near) return edgeLit(edge) ? 1 : 0.25;
  return 1;
}
