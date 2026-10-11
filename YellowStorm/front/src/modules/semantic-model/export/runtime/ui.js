// The page around the drawing: legend, search, selection bar, status line and the record panel. It drives the renderer
// (createRenderer, from renderer-svg.js or renderer-sigma.js) through four calls: refresh, centerOn, fit and fitTo.
const byId = (id) => document.getElementById(id);
const MAX_RESULTS = 8;
let renderer = null;

function renderLegend() {
  const legend = byId('legend');
  legend.replaceChildren(...concepts.map((concept, c) => {
    const shown = !state.hidden.has(c);
    return el('button', {
      type: 'button', class: 'chip' + (shown ? '' : ' off'), 'aria-pressed': String(shown),
      title: fmt(shown ? T.hideConcept : T.showConcept, { concept: concept.label }),
      onclick: () => { if (shown) state.hidden.add(c); else state.hidden.delete(c); update(); },
    }, [el('span', { class: 'dot', style: 'background:' + concept.color + (shown ? '' : ';opacity:.3') }), concept.label, el('span', { class: 'count', text: number(conceptCounts[c]) })]);
  }));
  if (state.hidden.size) legend.appendChild(el('button', { type: 'button', class: 'link small', text: T.showAll, onclick: () => { state.hidden.clear(); update(); } }));
}

function renderStatus() {
  const shown = nodes.filter((node) => !nodeHidden(node.i)).length;
  byId('showing').textContent = fmt(T.showing, { shown: number(shown), total: number(nodes.length) });
}

function renderSelection() {
  const bar = byId('selection');
  const node = state.selected >= 0 ? nodes[state.selected] : null;
  bar.hidden = !node;
  if (!node) return;
  const concept = concepts[node.c];
  bar.replaceChildren(
    el('span', { class: 'dot', style: 'background:' + concept.color }),
    el('span', { class: 'name', text: node.label, title: node.label }),
    el('span', { class: 'muted small', text: concept.label }),
    el('button', { type: 'button', text: T.details, 'aria-pressed': String(state.panelOpen), onclick: () => { state.panelOpen = !state.panelOpen; renderPanelArea(); renderSelection(); } }),
    el('button', { type: 'button', text: T.centerOn, onclick: () => renderer.centerOn(node.i) }),
    el('button', { type: 'button', class: 'icon', 'aria-label': T.clearSelection, title: T.clearSelection, text: '✕', onclick: () => select(-1) }),
  );
}

function renderPanelArea() {
  const panel = byId('panel');
  const node = state.selected >= 0 ? nodes[state.selected] : null;
  panel.hidden = !(node && state.panelOpen);
  if (!panel.hidden) renderPanel(panel, node, goTo, (i) => renderer.centerOn(i), () => { state.panelOpen = false; renderPanelArea(); renderSelection(); });
}

/** Redraws everything that depends on what is shown. */
function update() {
  computeNear();
  renderer.refresh();
  renderLegend();
  renderStatus();
  renderSelection();
  renderPanelArea();
}

/** Hovering only fades and lights the drawing. */
function hover(i) {
  if (state.hover === i) return;
  state.hover = i;
  computeNear();
  renderer.refresh();
}

function select(i) {
  state.selected = i;
  if (i < 0) state.panelOpen = false;
  update();
}

/** Selects a record, shows its concept again if it was hidden, and brings it to the middle. */
function goTo(i) {
  state.hidden.delete(nodes[i].c);
  state.selected = i;
  update();
  renderer.centerOn(i);
}

// Search: names, ids and, when the file holds them, values. Matches light up in the drawing; the first few are listed.
const foldedValues = new Map();
function valuesOf(node) {
  if (!foldedValues.has(node.i)) foldedValues.set(node.i, node.values.map((value) => (value ? fold(value) : '')));
  return foldedValues.get(node.i);
}

function searchRecords(query) {
  const needle = fold(query.trim());
  if (!needle) return [];
  const hits = [];
  for (const node of nodes) {
    let score = 0;
    let field = null;
    if (node.folded === needle) score = 4;
    else if (node.folded.startsWith(needle)) score = 3;
    else if (node.folded.includes(needle)) score = 2;
    else if (node.foldedId.includes(needle)) score = 1.5;
    else if (node.values) {
      const found = valuesOf(node).findIndex((value) => value.includes(needle));
      if (found >= 0) { score = 1; field = found; }
    }
    if (score) hits.push({ node, score, field });
  }
  return hits.sort((a, b) => b.score - a.score);
}

let fitTimer = 0;
function runSearch() {
  const input = byId('search');
  const results = byId('results');
  const hits = searchRecords(input.value);
  state.matches = hits.length ? new Set(hits.map((hit) => hit.node.i)) : null;
  update();
  results.hidden = !input.value.trim();
  results.replaceChildren(...(hits.length ? hits.slice(0, MAX_RESULTS).map(({ node, field }) => {
    const concept = concepts[node.c];
    return el('li', { role: 'option' }, [el('button', { type: 'button', onmousedown: (event) => event.preventDefault(), onclick: () => pick(node.i) }, [
      el('span', { class: 'dot', style: 'background:' + concept.color }),
      el('span', { class: 'grow' }, [
        el('span', { class: 'name', text: node.label }),
        field === null ? null : el('span', { class: 'muted small name', text: concept.fields[field] + ': ' + node.values[field] }),
      ]),
      el('span', { class: 'muted small', text: concept.label }),
    ])]);
  }) : [el('li', { class: 'empty', text: T.noMatch })]));
  // Once typing pauses, the view moves to the matches (when there are few enough to see).
  clearTimeout(fitTimer);
  fitTimer = setTimeout(() => { if (hits.length && hits.length <= 1000) renderer.fitTo(hits.map((hit) => hit.node.i).filter((i) => !nodeHidden(i))); }, 250);
}

function clearSearch() {
  const input = byId('search');
  clearTimeout(fitTimer);
  input.value = '';
  byId('results').hidden = true;
  state.matches = null;
}

function pick(i) {
  clearSearch();
  goTo(i);
}

function boot() {
  const search = byId('search');
  search.placeholder = T.searchPlaceholder;
  search.setAttribute('aria-label', T.search);
  byId('results').setAttribute('aria-label', T.searchResults);
  byId('legend').setAttribute('aria-label', T.legend);
  byId('fit').textContent = T.fit;
  const names = byId('link-names');
  names.textContent = T.linkNames;
  names.hidden = DATA.mode !== 'svg';
  names.addEventListener('click', () => { state.linkNames = !state.linkNames; names.setAttribute('aria-pressed', String(state.linkNames)); renderer.refresh(); });
  byId('fit').addEventListener('click', () => renderer.fit());
  byId('missing-legend').textContent = T.missingLegend;
  byId('ring-legend').hidden = DATA.mode !== 'svg';

  let timer = 0;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(runSearch, 150); });
  search.addEventListener('focus', () => { if (search.value.trim()) byId('results').hidden = false; });
  search.addEventListener('blur', () => setTimeout(() => { byId('results').hidden = true; }, 150));
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { clearTimeout(timer); const hits = searchRecords(search.value); if (hits.length) pick(hits[0].node.i); }
    if (event.key === 'Escape') { clearSearch(); update(); search.blur(); }
  });
  window.addEventListener('keydown', (event) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
    if (event.key === '/' && !typing) { event.preventDefault(); search.focus(); return; }
    if (event.key !== 'Escape' || typing) return;
    if (state.panelOpen) { state.panelOpen = false; update(); } else if (state.selected >= 0) select(-1);
  });

  const loading = byId('loading');
  try {
    renderer = createRenderer(byId('graph'), { onSelect: select, onOpen: (i) => { state.selected = i; state.panelOpen = true; update(); }, onHover: hover });
  } catch (error) {
    console.error(error);
    loading.textContent = error && error.message === 'webgl' ? T.noWebgl : T.cannotOpen;
    return;
  }
  loading.hidden = true;
  update();
  renderer.fit(false);
}

boot();
