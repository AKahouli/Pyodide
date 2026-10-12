// The vector drawing: records as the app draws them (named circles, amber ring for missing data, arrowed links), placed
// where the app had laid them. Pan with the mouse or a finger, zoom with the wheel or a pinch.
function createRenderer(host, hooks) {
  const NS = 'http://www.w3.org/2000/svg';
  const MISSING_RING = '#fbbf24';
  const svgEl = (tag, attrs) => {
    const node = document.createElementNS(NS, tag);
    for (const key in attrs || {}) node.setAttribute(key, attrs[key]);
    return node;
  };

  const svg = svgEl('svg', { role: 'group', 'aria-label': fmt(T.canvasLabel, { shown: number(nodes.length) }) });
  const defs = svgEl('defs');
  const arrow = svgEl('marker', { id: 'arrow', viewBox: '0 -5 10 10', refX: 10, refY: 0, markerWidth: 6, markerHeight: 6, orient: 'auto' });
  arrow.appendChild(svgEl('path', { d: 'M0,-5L10,0L0,5', fill: 'rgba(255,255,255,0.45)' }));
  defs.appendChild(arrow);
  const root = svgEl('g');
  const edgeLayer = svgEl('g');
  const labelLayer = svgEl('g');
  const nodeLayer = svgEl('g');
  root.append(edgeLayer, labelLayer, nodeLayer);
  svg.append(defs, root);
  host.appendChild(svg);

  // Links end on the rim of each circle, so the arrowhead is seen.
  const lines = edges.map((edge) => {
    const a = nodes[edge.s];
    const b = nodes[edge.t];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    const line = svgEl('line', { 'marker-end': 'url(#arrow)' });
    if (length > a.size + b.size + 2) {
      line.setAttribute('x1', a.x + (dx / length) * a.size);
      line.setAttribute('y1', a.y + (dy / length) * a.size);
      line.setAttribute('x2', b.x - (dx / length) * b.size);
      line.setAttribute('y2', b.y - (dy / length) * b.size);
    } else line.setAttribute('display', 'none');
    edgeLayer.appendChild(line);
    return line;
  });
  const labels = new Map();
  const labelOf = (edge) => {
    if (!labels.has(edge.k)) {
      const a = nodes[edge.s];
      const b = nodes[edge.t];
      const text = svgEl('text', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 4, class: 'edge-label', 'text-anchor': 'middle' });
      text.textContent = edge.r;
      labelLayer.appendChild(text);
      labels.set(edge.k, text);
    }
    return labels.get(edge.k);
  };

  /** A name on two lines to fit inside its circle. */
  const wrap = (text, max) => {
    if (text.length <= max) return [text, null];
    const mid = Math.max(text.lastIndexOf(' ', max), text.lastIndexOf('-', max - 1));
    if (mid > 0) return [text.slice(0, mid + (text[mid] === '-' ? 1 : 0)), text.slice(mid + 1).slice(0, max)];
    return [text.slice(0, max - 1) + '…', null];
  };

  let moved = false;
  const groups = nodes.map((node) => {
    const group = svgEl('g', { class: 'node', role: 'button', tabindex: 0, transform: 'translate(' + node.x + ',' + node.y + ')', 'aria-label': node.label + ' · ' + concepts[node.c].label });
    if (node.missing.length) group.appendChild(svgEl('circle', { r: node.size + 5, fill: 'none', stroke: MISSING_RING, 'stroke-width': 2, 'stroke-dasharray': '4 3', opacity: 0.85 }));
    group.appendChild(svgEl('circle', { class: 'body', r: node.size, fill: concepts[node.c].color, stroke: 'rgba(255,255,255,0.18)', 'stroke-width': 2.5 }));
    const title = svgEl('title');
    title.textContent = node.label + ' · ' + concepts[node.c].label;
    group.appendChild(title);
    const max = Math.max(8, Math.round(node.size / 3));
    const [first, second] = wrap(node.label, max);
    const line = (dy, value, size, fill, weight) => {
      const text = svgEl('text', { 'text-anchor': 'middle', dy, fill, 'font-size': size, 'font-weight': weight, 'pointer-events': 'none' });
      text.textContent = value;
      group.appendChild(text);
    };
    line(second ? -7 : 0, first, 10, 'white', 700);
    if (second) line(6, second.length > max ? second.slice(0, max - 1) + '…' : second, 10, 'white', 700);
    group.addEventListener('click', (event) => { event.stopPropagation(); if (!moved) hooks.onSelect(node.i); });
    group.addEventListener('dblclick', (event) => { event.stopPropagation(); hooks.onOpen(node.i); });
    group.addEventListener('mouseenter', () => hooks.onHover(node.i));
    group.addEventListener('mouseleave', () => hooks.onHover(-1));
    group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); hooks.onSelect(node.i); } });
    nodeLayer.appendChild(group);
    return group;
  });

  // Pan and zoom: one transform on the root group.
  const view = { x: 0, y: 0, k: 1 };
  const apply = () => root.setAttribute('transform', 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')');
  const size = () => host.getBoundingClientRect();
  const zoomAt = (px, py, factor) => {
    const k = clamp(view.k * factor, 0.03, 3);
    const real = k / view.k;
    view.x = px - (px - view.x) * real;
    view.y = py - (py - view.y) * real;
    view.k = k;
    apply();
  };
  const animateTo = (target, animate) => {
    if (!animate || document.hidden) { Object.assign(view, target); apply(); return; }
    const from = { x: view.x, y: view.y, k: view.k };
    const began = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - began) / 400);
      const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      for (const key of ['x', 'y', 'k']) view[key] = from[key] + (target[key] - from[key]) * eased;
      apply();
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    const box = size();
    zoomAt(event.clientX - box.left, event.clientY - box.top, Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015)));
  }, { passive: false });

  const pointers = new Map();
  let pinch = 0;
  svg.addEventListener('pointerdown', (event) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
    moved = false;
    pinch = 0;
  });
  window.addEventListener('pointermove', (event) => {
    const last = pointers.get(event.pointerId);
    if (!last) return;
    if (pointers.size === 1) {
      // A click that wanders a few pixels is still a click.
      if (!moved && Math.hypot(event.clientX - last.startX, event.clientY - last.startY) > 4) moved = true;
      if (moved) { view.x += event.clientX - last.x; view.y += event.clientY - last.y; apply(); }
    }
    Object.assign(last, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const box = size();
      if (pinch) zoomAt((a.x + b.x) / 2 - box.left, (a.y + b.y) / 2 - box.top, distance / pinch);
      pinch = distance;
      moved = true;
    }
  });
  const release = (event) => { pointers.delete(event.pointerId); pinch = 0; };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  svg.addEventListener('click', () => { if (!moved) hooks.onSelect(-1); });

  const fitTo = (indices, animate) => {
    const box = size();
    const chosen = (indices || nodes.map((node) => node.i)).filter((i) => !nodeHidden(i)).map((i) => nodes[i]);
    if (!box.width || !chosen.length) return;
    let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const node of chosen) {
      minX = Math.min(minX, node.x - node.size); maxX = Math.max(maxX, node.x + node.size);
      minY = Math.min(minY, node.y - node.size); maxY = Math.max(maxY, node.y + node.size);
    }
    [minX, maxX, minY, maxY] = [minX - 40, maxX + 40, minY - 40, maxY + 40];
    const k = Math.min(1.6, box.width / (maxX - minX), box.height / (maxY - minY));
    animateTo({ x: box.width / 2 - ((minX + maxX) / 2) * k, y: box.height / 2 - ((minY + maxY) / 2) * k, k }, animate !== false);
  };

  const refresh = () => {
    const focus = focusIndex();
    nodes.forEach((node, i) => {
      const alpha = nodeAlpha(i);
      const group = groups[i];
      group.setAttribute('display', alpha ? 'inline' : 'none');
      group.setAttribute('opacity', alpha);
      const body = group.querySelector('circle.body');
      body.setAttribute('stroke', i === state.selected ? '#ffffff' : 'rgba(255,255,255,0.18)');
      body.setAttribute('stroke-width', i === state.selected ? 4 : 2.5);
    });
    edges.forEach((edge) => {
      const alpha = edgeAlpha(edge);
      const line = lines[edge.k];
      const lit = focus >= 0 && edgeLit(edge);
      if (line.getAttribute('x1') !== null) line.setAttribute('display', alpha ? 'inline' : 'none');
      line.setAttribute('opacity', alpha);
      line.setAttribute('stroke', lit ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.15)');
      line.setAttribute('stroke-width', lit ? 2.5 : 1.25);
      const showName = alpha > 0 && (state.linkNames || lit) && line.getAttribute('x1') !== null;
      if (showName || labels.has(edge.k)) labelOf(edge).setAttribute('display', showName ? 'inline' : 'none');
    });
  };

  return {
    refresh,
    fit: (animate) => fitTo(null, animate),
    fitTo: (indices) => fitTo(indices, true),
    centerOn: (i) => {
      const box = size();
      const node = nodes[i];
      const k = Math.max(view.k, 1);
      animateTo({ x: box.width / 2 - node.x * k, y: box.height / 2 - node.y * k, k }, true);
    },
  };
}
