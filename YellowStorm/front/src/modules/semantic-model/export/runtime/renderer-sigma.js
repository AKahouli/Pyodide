// The WebGL drawing, for graphs too large for a vector one: sigma.js over a graphology graph, records placed where the app
// had laid them. Fading, hiding and emphasis are reducers over the shared state; hover, click and search work as in the app.
function createRenderer(host, hooks) {
  const BACKGROUND = [15, 15, 26];
  // Plain colours: they read the same on any screen, with no blending of the thousands of links that cross.
  const EDGE = '#2b2b45';
  const EDGE_LIT = '#e5e7eb';
  const EDGE_DIM = '#17172b';
  const large = nodes.length > 2000;
  // How close a record is brought: a big graph needs to be well zoomed to tell records apart, a small one hardly at all.
  const CLOSE = large ? 0.12 : nodes.length > 300 ? 0.3 : 0.6;
  // Smaller bubbles as the graph grows, so that they stay apart.
  const scale = nodes.length > 20000 ? 0.4 : nodes.length > 5000 ? 0.6 : 1;

  /** A concept's colour mixed into the background, for records faded behind others (WebGL has no per-record opacity). */
  const dimmed = concepts.map((concept) => {
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(concept.color);
    if (!match) return '#2a2a3a';
    const mixed = [1, 2, 3].map((part, channel) => Math.round(parseInt(match[part], 16) * 0.2 + BACKGROUND[channel] * 0.8));
    return 'rgb(' + mixed.join(',') + ')';
  });

  const graph = new graphology.MultiDirectedGraph();
  for (const node of nodes) {
    graph.addNode(String(node.i), { x: node.x, y: node.y, size: clamp((node.size / 4) * scale, 2, 14), color: concepts[node.c].color, label: node.label });
  }
  // Links are thin lines; the ones of the record in focus turn into arrows (see the edge reducer).
  for (const edge of edges) {
    if (edge.s !== edge.t) graph.addEdgeWithKey('e' + edge.k, String(edge.s), String(edge.t), { size: 0.6, color: EDGE, type: 'line' });
  }

  /** The hovered or selected record is drawn with its name on a dark label. */
  const drawHover = (context, data, settings) => {
    const size = settings.labelSize;
    context.font = settings.labelWeight + ' ' + size + 'px ' + settings.labelFont;
    context.beginPath();
    context.arc(data.x, data.y, data.size + 2, 0, Math.PI * 2);
    context.strokeStyle = '#ffffff';
    context.lineWidth = 2;
    context.stroke();
    if (typeof data.label !== 'string') return;
    const width = context.measureText(data.label).width + 10;
    context.fillStyle = '#1a1a2b';
    context.fillRect(data.x + data.size + 4, data.y - size / 2 - 4, width, size + 8);
    context.fillStyle = '#ffffff';
    context.fillText(data.label, data.x + data.size + 9, data.y + size / 3);
  };

  let sigma;
  try {
    sigma = new Sigma.Sigma(graph, host, {
      labelColor: { color: '#e5e7eb' },
      labelRenderedSizeThreshold: 5,
      labelDensity: large ? 0.4 : 1,
      defaultDrawNodeHover: drawHover,
      zIndex: true,
      minCameraRatio: 0.005,
      maxCameraRatio: 4,
      nodeReducer: (key, attrs) => {
        const i = Number(key);
        if (nodeHidden(i)) return Object.assign({}, attrs, { hidden: true });
        const alpha = nodeAlpha(i);
        const lit = alpha === 1 && (state.matches !== null || state.near !== null);
        const out = Object.assign({}, attrs, { zIndex: lit ? 1 : 0 });
        if (alpha < 1) { out.color = dimmed[nodes[i].c]; out.label = null; }
        if (lit) out.forceLabel = true;
        if (i === state.selected) { out.highlighted = true; out.zIndex = 2; }
        return out;
      },
      edgeReducer: (key, attrs) => {
        const edge = edges[Number(key.slice(1))];
        if (edgeHidden(edge)) return Object.assign({}, attrs, { hidden: true });
        if (edgeLit(edge) && !state.matches) return Object.assign({}, attrs, { color: EDGE_LIT, type: 'arrow', size: large ? 0.5 : 1.2, zIndex: 1 });
        return edgeAlpha(edge) < 1 ? Object.assign({}, attrs, { color: EDGE_DIM }) : attrs;
      },
    });
  } catch (error) {
    throw new Error('webgl', { cause: error });
  }

  sigma.on('enterNode', ({ node }) => hooks.onHover(Number(node)));
  sigma.on('leaveNode', () => hooks.onHover(-1));
  sigma.on('clickNode', ({ node }) => hooks.onSelect(Number(node)));
  sigma.on('clickStage', () => hooks.onSelect(-1));
  // A double click opens the record's details instead of zooming in.
  sigma.on('doubleClickNode', (payload) => { payload.preventSigmaDefault(); hooks.onOpen(Number(payload.node)); });

  const camera = sigma.getCamera();
  const duration = 400;

  const fitTo = (indices, animate) => {
    const chosen = (indices || nodes.map((node) => node.i)).filter((i) => !nodeHidden(i));
    if (!chosen.length) return;
    if (chosen.length === nodes.length) {
      if (animate) camera.animatedReset({ duration }); else camera.setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
      return;
    }
    let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const i of chosen) {
      const shown = sigma.getNodeDisplayData(String(i));
      minX = Math.min(minX, shown.x); maxX = Math.max(maxX, shown.x);
      minY = Math.min(minY, shown.y); maxY = Math.max(maxY, shown.y);
    }
    const target = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, ratio: clamp(Math.max(maxX - minX, maxY - minY) * 1.3 + 0.02, CLOSE, 1.5) };
    if (animate) camera.animate(target, { duration }); else camera.setState(target);
  };

  return {
    // Positions have not changed: only what the reducers say.
    refresh: () => sigma.refresh({ skipIndexation: true }),
    fit: (animate) => fitTo(null, animate !== false),
    fitTo: (indices) => fitTo(indices, true),
    centerOn: (i) => {
      const shown = sigma.getNodeDisplayData(String(i));
      camera.animate({ x: shown.x, y: shown.y, ratio: Math.min(camera.getState().ratio, CLOSE) }, { duration });
    },
  };
}
