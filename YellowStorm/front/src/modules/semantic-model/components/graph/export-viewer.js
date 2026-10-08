/* The viewer inside an exported data graph file: runs offline, with the d3 modules inlined before it. */
/* global d3 */
(async function main() {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const el = (tag, attributes = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (key === 'class') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : String(child));
    return node;
  };

  // The data travels gzipped and base64-encoded; browsers unpack it themselves.
  const packed = $('#graph-data');
  const bytes = Uint8Array.from(atob(packed.textContent.trim()), (char) => char.charCodeAt(0));
  const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const data = JSON.parse(text);
  packed.remove();
  const { meta, t, concepts, relations, records, links } = data;
  const LIMIT = meta.drawLimit || 1500;

  document.title = meta.title;
  $('#title').textContent = meta.title;
  $('#subtitle').textContent = meta.subtitle;

  const fold = (value) => String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const isMissing = (value) => value === null || value === undefined || value === '' || value === '__missing__';
  const show = (value) => (Array.isArray(value) ? value.map(show).join(', ') : typeof value === 'boolean' ? (value ? t.yes : t.no) : value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value));

  // Each record's links, both ways: [other record, relation, outgoing].
  const linksOf = records.map(() => []);
  links.forEach(([source, target, relation]) => { linksOf[source].push([target, relation, true]); linksOf[target].push([source, relation, false]); });
  const counts = concepts.map(() => 0);
  for (const record of records) counts[record[1]]++;

  const state = { selected: null, hovered: null, hidden: new Set(), neighboursOnly: false, linkNames: false, drawAll: false };

  // ── What is drawn: the records shown, or one bubble per concept when there are too many ──
  function shownRecords() {
    if (state.neighboursOnly && state.selected !== null) return new Set([state.selected, ...linksOf[state.selected].map(([other]) => other)]);
    const shown = new Set();
    records.forEach((record, id) => { if (!state.hidden.has(record[1])) shown.add(id); });
    if (state.selected !== null) shown.add(state.selected);
    return shown;
  }
  function scene() {
    const shown = shownRecords();
    if (shown.size <= LIMIT || state.drawAll) {
      const nodes = [...shown].map((id) => {
        const [label, concept, , missing] = records[id];
        return { id: `r${id}`, record: id, label, sub: concepts[concept].label, color: concepts[concept].color, r: 24 + Math.min(26, Math.sqrt(linksOf[id].length) * 5), ring: missing > 0 };
      });
      const edges = [];
      links.forEach(([source, target, relation], id) => { if (shown.has(source) && shown.has(target)) edges.push({ id, source: `r${source}`, target: `r${target}`, label: relations[relation], ends: [source, target] }); });
      return { nodes, edges, summary: false, shown };
    }
    const byConcept = concepts.map(() => 0);
    for (const id of shown) byConcept[records[id][1]]++;
    const pairs = new Map();
    for (const [source, target, relation] of links) {
      if (!shown.has(source) || !shown.has(target)) continue;
      const key = `${relation}|${records[source][1]}|${records[target][1]}`;
      const pair = pairs.get(key) ?? { id: key, source: `c${records[source][1]}`, target: `c${records[target][1]}`, relation, count: 0 };
      pair.count++;
      pairs.set(key, pair);
    }
    return {
      nodes: concepts.flatMap((concept, index) => (byConcept[index] ? [{ id: `c${index}`, concept: index, label: concept.label, sub: byConcept[index].toLocaleString(), color: concept.color, r: 40 + Math.min(60, Math.sqrt(byConcept[index]) / 2) }] : [])),
      edges: [...pairs.values()].map((pair) => ({ ...pair, label: `${relations[pair.relation]} · ${pair.count.toLocaleString()}` })),
      summary: true,
      shown,
    };
  }

  // ── The drawing: d3 forces in SVG, positions kept between redraws ─────────
  const container = $('#graph');
  const svg = d3.select(container).append('svg').attr('role', 'group').attr('aria-label', meta.title);
  const defs = svg.append('defs');
  const layer = svg.append('g');
  const zoom = d3.zoom().scaleExtent([0.03, 3]).on('zoom', (event) => layer.attr('transform', event.transform));
  svg.call(zoom).on('dblclick.zoom', null).on('click', () => select(null));
  const positions = new Map();
  let simulation = null;
  let current = { nodes: [], drawnNodes: [], node: null, link: null, linkLabel: null };

  const markerFor = (r) => {
    const id = `arrow-${Math.round(r)}`;
    if (defs.select(`#${id}`).empty()) {
      defs.append('marker').attr('id', id).attr('viewBox', '0 -5 10 10').attr('refX', r + 11).attr('refY', 0).attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto')
        .append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', 'rgba(255,255,255,0.35)');
    }
    return `url(#${id})`;
  };
  const wrapLines = (value, maxLen) => {
    if (value.length <= maxLen) return [value, null];
    const mid = Math.max(value.lastIndexOf(' ', maxLen), value.lastIndexOf('-', maxLen - 1));
    if (mid > 0) { const rest = value.slice(mid + 1); return [value.slice(0, mid + (value[mid] === '-' ? 1 : 0)), rest.length > maxLen ? `${rest.slice(0, maxLen - 1)}…` : rest]; }
    return [`${value.slice(0, maxLen - 1)}…`, null];
  };
  const size = () => container.getBoundingClientRect();
  const goTo = (transform, animate) => (animate && !document.hidden ? svg.transition().duration(450).call(zoom.transform, transform) : svg.call(zoom.transform, transform));
  function fit(animate = true) {
    const { width, height } = size();
    if (!width || !current.drawnNodes.length) return;
    let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const node of current.drawnNodes) { minX = Math.min(minX, node.x - node.r); maxX = Math.max(maxX, node.x + node.r); minY = Math.min(minY, node.y - node.r); maxY = Math.max(maxY, node.y + node.r); }
    const scale = Math.min(1.6, width / (maxX - minX + 80), height / (maxY - minY + 80));
    goTo(d3.zoomIdentity.translate(width / 2 - ((minX + maxX) / 2) * scale, height / 2 - ((minY + maxY) / 2) * scale).scale(scale), animate);
  }
  function centerOn(record) {
    const node = current.drawnNodes.find((item) => item.record === record);
    const { width, height } = size();
    if (!node || !width) return;
    const scale = Math.max(d3.zoomTransform(svg.node()).k, 1);
    goTo(d3.zoomIdentity.translate(width / 2 - node.x * scale, height / 2 - node.y * scale).scale(scale), true);
  }

  function restyle() {
    const { node, link, linkLabel } = current;
    if (!node) return;
    const focus = state.hovered ?? (state.selected !== null ? `r${state.selected}` : null);
    const near = focus ? new Set([focus]) : null;
    if (focus) link.each((item) => { if (item.source.id === focus) near.add(item.target.id); if (item.target.id === focus) near.add(item.source.id); });
    const touches = (item) => Boolean(focus && (item.source.id === focus || item.target.id === focus));
    node.attr('opacity', (item) => (near ? (near.has(item.id) ? 1 : 0.3) : 1));
    node.select('circle.body').attr('stroke', (item) => (item.record === state.selected ? '#ffffff' : 'rgba(255,255,255,0.18)')).attr('stroke-width', (item) => (item.record === state.selected ? 4 : 2.5));
    link.attr('stroke', (item) => (touches(item) ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.15)')).attr('stroke-width', (item) => (touches(item) ? 2.5 : 1.25))
      .attr('opacity', (item) => (near ? (touches(item) ? 1 : 0.25) : 1));
    linkLabel.attr('display', (item) => (state.linkNames || touches(item) || current.summary ? null : 'none'));
  }

  function draw() {
    const { nodes, edges, summary, shown } = scene();
    const { width, height } = size();
    if (simulation) simulation.stop();
    layer.selectAll('*').remove();
    const firstTime = !current.node;
    const fresh = nodes.some((node) => !positions.has(node.id));
    const spread = Math.max(400, Math.sqrt(nodes.length) * 70);
    const byId = new Map(nodes.map((node) => {
      const known = positions.get(node.id);
      node.x = known ? known.x : width / 2 + (Math.random() - 0.5) * spread;
      node.y = known ? known.y : height / 2 + (Math.random() - 0.5) * spread;
      return [node.id, node];
    }));
    for (const edge of edges) {
      const [a, b] = [byId.get(edge.source), byId.get(edge.target)];
      if (!positions.has(a.id) && positions.has(b.id)) { a.x = b.x + (Math.random() - 0.5) * 60; a.y = b.y + (Math.random() - 0.5) * 60; }
      if (!positions.has(b.id) && positions.has(a.id)) { b.x = a.x + (Math.random() - 0.5) * 60; b.y = a.y + (Math.random() - 0.5) * 60; }
    }
    const simLinks = edges.map((edge) => ({ ...edge }));
    simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(simLinks).id((d) => d.id).distance(summary ? 260 : 160).strength(0.35))
      .force('charge', d3.forceManyBody().strength(summary ? -1200 : -320).theta(0.9))
      .force('collision', d3.forceCollide((d) => d.r + 10))
      .force('x', d3.forceX(width / 2).strength(0.08)).force('y', d3.forceY(height / 2).strength(0.08))
      .alphaDecay(0.03);

    const link = layer.append('g').selectAll('line').data(simLinks).join('line').attr('marker-end', (d) => markerFor(byId.get(typeof d.target === 'object' ? d.target.id : d.target).r));
    const linkLabel = layer.append('g').selectAll('text').data(simLinks).join('text').text((d) => d.label)
      .attr('fill', 'rgba(255,255,255,0.6)').attr('font-size', 10).attr('text-anchor', 'middle').attr('pointer-events', 'none')
      .attr('paint-order', 'stroke').attr('stroke', '#0f0f1a').attr('stroke-width', 3);
    const drag = d3.drag()
      .on('start', (event, d) => { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on('end', (event, d) => { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; });
    const node = layer.append('g').selectAll('g').data(nodes).join('g')
      .attr('role', 'button').attr('tabindex', 0).attr('aria-label', (d) => `${d.label} · ${d.sub}`).style('cursor', 'pointer')
      .on('click', (event, d) => { event.stopPropagation(); open(d); })
      .on('dblclick', (event, d) => { event.stopPropagation(); if (d.record !== undefined) { select(d.record); state.neighboursOnly = true; draw(); } })
      .on('keydown', (event, d) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(d); } })
      .on('mouseenter', (_event, d) => { state.hovered = d.id; restyle(); })
      .on('mouseleave', () => { state.hovered = null; restyle(); })
      .call(drag);
    node.filter((d) => d.ring).append('circle').attr('r', (d) => d.r + 5).attr('fill', 'none').attr('stroke', '#fbbf24').attr('stroke-width', 2).attr('stroke-dasharray', '4 3').attr('opacity', 0.85);
    node.append('circle').attr('class', 'body').attr('r', (d) => d.r).attr('fill', (d) => d.color);
    node.append('title').text((d) => `${d.label} · ${d.sub}`);
    node.each(function label(d) {
      const group = d3.select(this);
      const maxLen = Math.max(8, Math.round(d.r / 3));
      const [line1, line2] = wrapLines(d.label, maxLen);
      const offset = line2 ? -7 : 0;
      const write = (dy, value, fontSize, fill, weight) => group.append('text').attr('text-anchor', 'middle').attr('dy', dy).attr('fill', fill)
        .attr('font-size', fontSize).attr('font-weight', weight).attr('pointer-events', 'none').text(value);
      write(offset, line1, d.record === undefined ? 13 : 10, 'white', 700);
      if (line2) write(offset + 13, line2, 10, 'white', 700);
      if (d.r >= 30) write(line2 ? offset + 26 : 16, d.sub, d.record === undefined ? 11 : 8, 'rgba(255,255,255,0.6)', 400);
    });

    const place = () => {
      link.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y).attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
      linkLabel.attr('x', (d) => (d.source.x + d.target.x) / 2).attr('y', (d) => (d.source.y + d.target.y) / 2 - 4);
      node.attr('transform', (d) => `translate(${d.x},${d.y})`);
      for (const item of nodes) positions.set(item.id, { x: item.x, y: item.y });
    };
    simulation.on('tick', place);
    // Worked out for a moment at most before it is drawn, so the page never freezes; then it finishes settling live.
    simulation.stop();
    if (!fresh) simulation.alpha(0.6);
    const budgetEnd = performance.now() + 300;
    for (let tick = 0; tick < (fresh ? 300 : 100) && performance.now() < budgetEnd; tick++) simulation.tick();
    place();
    if (fresh && simulation.alpha() > 0.1) simulation.on('end.fit', () => fit());
    simulation.alpha(Math.min(simulation.alpha(), 0.5)).restart();

    current = { nodes, drawnNodes: nodes, node, link, linkLabel, summary };
    if (firstTime || fresh) fit(!firstTime);
    restyle();
    $('#note').hidden = !summary;
    if (summary) {
      $('#note').replaceChildren(
        el('p', {}, t.tooManyToDraw.replace('{{records}}', shown.size.toLocaleString()).replace('{{limit}}', LIMIT.toLocaleString())),
        shown.size <= meta.maxDraw ? el('button', { type: 'button', class: 'link', onclick: () => { state.drawAll = true; draw(); } }, t.drawAll.replace('{{records}}', shown.size.toLocaleString())) : '',
      );
    }
    $('#showing').textContent = t.showing.replace('{{shown}}', (summary ? shown.size : nodes.length).toLocaleString()).replace('{{total}}', records.length.toLocaleString());
  }
  /** A record opens in the panel; a concept bubble shows that concept alone. */
  function open(d) {
    if (d.record !== undefined) { select(d.record); return; }
    concepts.forEach((_concept, index) => { if (index === d.concept) state.hidden.delete(index); else state.hidden.add(index); });
    drawLegend();
    draw();
  }

  // ── Legend: each concept with its records; clicking shows or hides them ───
  const legend = $('#legend');
  const drawLegend = () => {
    legend.replaceChildren(...concepts.map((concept, index) => el('button', {
      type: 'button', class: `chip${state.hidden.has(index) ? ' off' : ''}`, 'aria-pressed': String(!state.hidden.has(index)),
      onclick: () => { if (state.hidden.has(index)) state.hidden.delete(index); else state.hidden.add(index); state.drawAll = false; drawLegend(); draw(); },
    }, el('span', { class: 'dot', style: `background:${concept.color}` }), concept.label, el('span', { class: 'count' }, counts[index].toLocaleString()))),
    state.hidden.size ? el('button', { type: 'button', class: 'link', onclick: () => { state.hidden.clear(); state.drawAll = false; drawLegend(); draw(); } }, t.showAll) : '');
  };
  drawLegend();

  // ── Tools ─────────────────────────────────────────────────────────────────
  $('#fit').addEventListener('click', () => fit());
  $('#fit').textContent = t.fit;
  const linkNames = $('#link-names');
  linkNames.textContent = t.linkNames;
  linkNames.addEventListener('click', () => { state.linkNames = !state.linkNames; linkNames.setAttribute('aria-pressed', String(state.linkNames)); restyle(); });

  // ── Search: names first, then values ──────────────────────────────────────
  let foldedNames = null;
  let foldedValues = null;
  const search = $('#search');
  const results = $('#results');
  search.placeholder = t.searchPlaceholder;
  search.setAttribute('aria-label', t.search);
  const find = (query) => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    foldedNames ??= records.map((record) => fold(record[0]));
    const hits = [];
    for (let id = 0; id < records.length && hits.length < 200; id++) { const name = foldedNames[id]; if (words.every((word) => name.includes(word))) hits.push({ id, score: name.startsWith(words[0]) ? 0 : 1 }); }
    hits.sort((a, b) => a.score - b.score);
    if (hits.length < 8) {
      foldedValues ??= records.map((record) => (record[2] ?? []).map((value) => (isMissing(value) ? '' : fold(show(value)))));
      const named = new Set(hits.map((hit) => hit.id));
      for (let id = 0; id < records.length && hits.length < 8; id++) {
        if (named.has(id)) continue;
        const field = foldedValues[id].findIndex((value) => value && words.every((word) => value.includes(word)));
        if (field >= 0) hits.push({ id, field });
      }
    }
    return hits.slice(0, 8);
  };
  const pick = (id) => {
    search.value = '';
    results.hidden = true;
    state.hidden.delete(records[id][1]);
    drawLegend();
    // Among too many records to draw, a record found opens with its neighbours.
    if (current.summary) state.neighboursOnly = true;
    select(id);
    setTimeout(() => centerOn(id), 60);
  };
  search.addEventListener('input', () => {
    const hits = find(search.value);
    results.hidden = !search.value.trim();
    results.replaceChildren(...(hits.length ? hits.map(({ id, field }) => {
      const [label, concept] = records[id];
      return el('li', {}, el('button', { type: 'button', onmousedown: (event) => event.preventDefault(), onclick: () => pick(id) },
        el('span', { class: 'dot', style: `background:${concepts[concept].color}` }),
        el('span', { class: 'grow' }, el('span', { class: 'name' }, label),
          field !== undefined ? el('span', { class: 'sub' }, `${concepts[concept].fields[field]}: ${show(records[id][2][field]).slice(0, 120)}`) : ''),
        el('span', { class: 'sub' }, concepts[concept].label)));
    }) : [el('li', { class: 'empty' }, t.noMatch)]));
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { const first = find(search.value)[0]; if (first) pick(first.id); }
    if (event.key === 'Escape') { search.value = ''; results.hidden = true; search.blur(); }
  });
  search.addEventListener('blur', () => setTimeout(() => { results.hidden = true; }, 150));
  document.addEventListener('keydown', (event) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
    if (event.key === '/' && !typing) { event.preventDefault(); search.focus(); }
    if (event.key === 'Escape' && !typing && state.selected !== null) select(null);
  });

  // ── The selected record: values, then linked records by relationship ─────
  const panel = $('#panel');
  function select(id) {
    const was = shownRecords();
    const neighboursBefore = state.neighboursOnly;
    state.selected = id;
    if (id === null) state.neighboursOnly = false;
    // Redraw only when what is shown changes; otherwise restyle in place.
    const now = shownRecords();
    if (neighboursBefore !== state.neighboursOnly || now.size !== was.size || [...now].some((item) => !was.has(item)) || !current.drawnNodes.some((node) => node.record === id) && id !== null) draw();
    else restyle();
    if (id === null) { panel.hidden = true; return; }
    const [label, conceptIndex, values = [], missing] = records[id];
    const concept = concepts[conceptIndex];
    const rows = concept.fields.map((field, position) => ({ field, value: values[position] }));
    const filled = rows.filter((row) => !isMissing(row.value));
    const empty = rows.filter((row) => isMissing(row.value));
    const groups = new Map();
    for (const [other, relation, outgoing] of linksOf[id]) {
      const key = `${relation}|${outgoing}|${records[other][1]}`;
      const group = groups.get(key) ?? { label: relations[relation], outgoing, concept: concepts[records[other][1]].label, ids: new Set() };
      group.ids.add(other);
      groups.set(key, group);
    }
    const valueRow = ({ field, value }) => {
      const shown = show(value);
      const long = shown.length > 160 || shown.split('\n').length > 3;
      const body = el('dd', { class: long ? 'clamp' : '' }, shown);
      return el('div', { class: 'row' }, el('dt', {}, field), body,
        long ? el('button', { type: 'button', class: 'link small', onclick: (event) => { const closed = body.classList.toggle('clamp'); event.target.textContent = closed ? t.showMore : t.showLess; } }, t.showMore) : '');
    };
    panel.replaceChildren(
      el('header', {},
        el('div', { class: 'grow' },
          el('span', { class: 'badge', style: `background:${concept.color}33` }, el('span', { class: 'dot', style: `background:${concept.color}` }), concept.label),
          el('h2', {}, label),
          el('p', { class: 'sub' }, t.recordSummary.replace('{{filled}}', filled.length).replace('{{total}}', rows.length).replace('{{links}}', linksOf[id].length))),
        el('button', { type: 'button', class: 'icon', title: t.centerOn, 'aria-label': t.centerOn, onclick: () => centerOn(id) }, '◎'),
        el('button', { type: 'button', class: 'icon', 'aria-label': t.close, onclick: () => select(null) }, '✕')),
      el('div', { class: 'scroll' },
        el('label', { class: 'toggle' }, el('input', { type: 'checkbox', checked: state.neighboursOnly, onchange: (event) => { state.neighboursOnly = event.target.checked; draw(); } }), t.neighboursOnly),
        el('h3', {}, t.values),
        filled.length ? el('dl', {}, filled.map(valueRow)) : el('p', { class: 'sub' }, t.noValues),
        empty.length || missing ? el('details', {}, el('summary', {}, t.missingCount.replace('{{count}}', empty.length || missing)), el('dl', {}, empty.map(({ field }) => el('div', { class: 'row' }, el('dt', {}, field), el('dd', { class: 'missing' }, t.missingValue))))) : '',
        el('h3', {}, t.linked),
        groups.size ? el('ul', { class: 'groups' }, [...groups.values()].sort((a, b) => b.ids.size - a.ids.size).map((group) => {
          const ids = [...group.ids];
          return el('li', {}, el('details', { open: ids.length <= 3 },
            el('summary', {}, `${group.label} ${group.outgoing ? '→' : '←'} `, el('strong', {}, `${ids.length} ${group.concept}`)),
            el('ul', {}, ids.slice(0, 100).map((other) => el('li', {}, el('button', { type: 'button', class: 'link', onclick: () => { select(other); centerOn(other); } }, records[other][0]))),
              ids.length > 100 ? el('li', { class: 'sub' }, t.andMore.replace('{{count}}', ids.length - 100)) : '')));
        })) : el('p', { class: 'sub' }, t.noLinks)),
    );
    panel.hidden = false;
  }

  draw();
  $('#loading').remove();
})().catch((error) => {
  const loading = document.querySelector('#loading');
  if (loading) loading.textContent = `${loading.dataset.error} (${error && error.message})`;
});
