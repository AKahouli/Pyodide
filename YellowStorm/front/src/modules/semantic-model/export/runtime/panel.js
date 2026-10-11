// The record panel: the selected record's values, the fields it misses, and what it is linked to. Closed until asked for.
const LONG_VALUE = 160;
const LINKED_SHOWN = 50;
const panelState = { showMissing: false, open: {}, forRecord: -1 };

function valueRow(label, text) {
  const long = text.length > LONG_VALUE || text.split('\n').length > 3;
  const dd = el('dd', { class: long ? 'clamp' : '', text });
  const kids = [el('dt', { text: label }), dd];
  if (long) {
    const more = el('button', { type: 'button', class: 'link small', text: T.showMore });
    more.addEventListener('click', () => {
      const clamped = dd.classList.toggle('clamp');
      more.textContent = clamped ? T.showMore : T.showLess;
    });
    kids.push(more);
  }
  return el('div', { class: 'row' }, kids);
}

/** Links of a record grouped by relationship, direction and the concept at the other end. */
function linkGroups(i) {
  const groups = new Map();
  for (const k of adjacent[i]) {
    const edge = edges[k];
    const outgoing = edge.s === i;
    const other = outgoing ? edge.t : edge.s;
    const key = edge.r + '|' + outgoing + '|' + nodes[other].c;
    if (!groups.has(key)) groups.set(key, { key, label: edge.r, outgoing, concept: concepts[nodes[other].c].label, records: [] });
    groups.get(key).records.push(other);
  }
  return [...groups.values()].sort((a, b) => b.records.length - a.records.length);
}

function renderPanel(panel, node, onSelect, onCenter, onClose) {
  if (panelState.forRecord !== node.i) { panelState.forRecord = node.i; panelState.showMissing = false; panelState.open = {}; }
  const concept = concepts[node.c];
  const hasValues = Boolean(node.values);
  const missing = new Set(node.missing);
  const filledFields = concept.fields.map((_, f) => f).filter((f) => !missing.has(f));
  const missingFields = [...missing];
  const rebuild = () => renderPanel(panel, node, onSelect, onCenter, onClose);

  const header = el('header', null, [
    el('div', { class: 'grow' }, [
      el('span', { class: 'badge', style: 'background:' + concept.color + '33' }, [el('span', { class: 'dot', style: 'background:' + concept.color }), concept.label]),
      el('h2', { text: node.label }),
      el('p', { class: 'sub', text: fmt(T.recordSummary, { filled: filledFields.length, total: concept.fields.length, links: adjacent[node.i].length }) }),
    ]),
    el('button', { type: 'button', class: 'icon', 'aria-label': T.centerOn, title: T.centerOn, text: '◎', onclick: () => onCenter(node.i) }),
    el('button', { type: 'button', class: 'icon', 'aria-label': T.close, title: T.close, text: '✕', onclick: onClose }),
  ]);

  const values = el('section', { 'aria-label': hasValues ? T.values : T.fields }, [el('h3', { text: hasValues ? T.values : T.fields })]);
  if (!concept.fields.length) values.appendChild(el('p', { class: 'muted', text: T.noAttributes }));
  else if (hasValues) values.appendChild(el('dl', null, filledFields.map((f) => valueRow(concept.fields[f], node.values[f] == null ? '' : node.values[f]))));
  else {
    values.appendChild(el('p', { class: 'muted', text: T.valuesNotIncluded }));
    values.appendChild(el('dl', null, filledFields.map((f) => el('div', { class: 'row' }, [el('dt', { text: concept.fields[f] })]))));
  }
  if (missingFields.length) {
    values.appendChild(el('button', {
      type: 'button', class: 'missing-toggle', 'aria-expanded': String(panelState.showMissing), text: (panelState.showMissing ? '▾ ' : '▸ ') + fmt(T.missingCount, { count: missingFields.length }),
      onclick: () => { panelState.showMissing = !panelState.showMissing; rebuild(); },
    }));
    if (panelState.showMissing) values.appendChild(el('dl', null, missingFields.map((f) => el('div', { class: 'row' }, [el('dt', { text: concept.fields[f] }), el('dd', { class: 'missing', text: T.missingValue })]))));
  }

  const linked = el('section', { 'aria-label': T.linked }, [el('h3', { text: T.linked })]);
  const groups = linkGroups(node.i);
  if (!groups.length) linked.appendChild(el('p', { class: 'muted', text: T.noLinks }));
  const list = el('ul', { class: 'groups' });
  for (const group of groups) {
    const open = panelState.open[group.key] === undefined ? group.records.length <= 3 : panelState.open[group.key];
    const item = el('li', null, [el('button', {
      type: 'button', class: 'group', 'aria-expanded': String(open),
      text: (open ? '▾ ' : '▸ ') + group.label + (group.outgoing ? ' → ' : ' ← ') + group.records.length + ' ' + group.concept,
      onclick: () => { panelState.open[group.key] = !open; rebuild(); },
    })]);
    if (open) {
      item.appendChild(el('ul', null, group.records.slice(0, LINKED_SHOWN).map((other) => el('li', null, [
        el('button', { type: 'button', class: 'link', text: nodes[other].label, title: nodes[other].label, onclick: () => onSelect(other) }),
      ]))));
      if (group.records.length > LINKED_SHOWN) item.appendChild(el('p', { class: 'muted small', text: fmt(T.andMore, { count: group.records.length - LINKED_SHOWN }) }));
    }
    list.appendChild(item);
  }
  linked.appendChild(list);

  panel.replaceChildren(header, el('div', { class: 'scroll' }, [values, linked]));
}
