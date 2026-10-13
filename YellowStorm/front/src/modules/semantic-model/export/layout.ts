import * as d3Force from 'd3-force';

type Place = { x: number; y: number };
type LayoutNode = d3Force.SimulationNodeDatum & { id: string; r: number };

const FRAME_MS = 40;
const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Places records the way the graph view does (free layout) for views the canvas holds no positions for, such as one drawn as
 * a bubble per concept. Works in short slices so the page stays responsive; large graphs get fewer rounds.
 */
export async function layoutRecords(nodes: Array<{ id: string; size: number }>, links: Array<{ source: string; target: string }>): Promise<Map<string, Place>> {
  const items: LayoutNode[] = nodes.map((node) => ({ id: node.id, r: node.size }));
  const known = new Set(items.map((item) => item.id));
  const sim = d3Force.forceSimulation<LayoutNode>(items)
    .force('link', d3Force.forceLink<LayoutNode, { source: string; target: string }>(links.filter((link) => known.has(link.source) && known.has(link.target)).map((link) => ({ ...link }))).id((item) => item.id).distance(160).strength(0.35))
    .force('charge', d3Force.forceManyBody<LayoutNode>().strength(-320).theta(0.9))
    .force('x', d3Force.forceX<LayoutNode>(0).strength(0.08))
    .force('y', d3Force.forceY<LayoutNode>(0).strength(0.08))
    .stop();
  // Collisions are exact but costly: past a few thousand records the charge keeps them apart well enough.
  if (items.length <= 5000) sim.force('collision', d3Force.forceCollide<LayoutNode>((item) => item.r + 10));
  const rounds = items.length <= 2000 ? 300 : Math.max(60, Math.round((300 * 2000) / items.length));
  let frameEnd = performance.now() + FRAME_MS;
  for (let round = 0; round < rounds; round++) {
    sim.tick();
    if (performance.now() > frameEnd) { await yieldToBrowser(); frameEnd = performance.now() + FRAME_MS; }
  }
  return new Map(items.map((item) => [item.id, { x: item.x ?? 0, y: item.y ?? 0 }]));
}
