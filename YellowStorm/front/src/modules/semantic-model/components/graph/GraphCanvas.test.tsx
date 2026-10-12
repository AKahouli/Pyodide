import { createRef } from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GraphCanvas, type CanvasEdge, type CanvasNode, type GraphCanvasHandle } from './GraphCanvas';

const nodes: CanvasNode[] = [
  { id: 'a', label: 'Alpha', color: '#2563eb', size: 28, concept: 'c', degree: 1, info: true, more: 2, moreLabel: 'More' },
  { id: 'b', label: 'Beta', color: '#16a34a', size: 28, concept: 'c', degree: 1, info: true },
];
const edges: CanvasEdge[] = [{ id: 'e', source: 'a', target: 'b', label: 'knows' }];

function renderCanvas(onInfo = vi.fn(), highlight: { ids: Set<string> } | null = null) {
  const ref = createRef<GraphCanvasHandle>();
  const view = render(<GraphCanvas ref={ref} nodes={nodes} edges={edges} dataKey='k' layout='force' radialCenter={null} conceptOrder={['c']}
    selectedId={null} highlight={highlight} linkNames={false} label='Graph' badgeLabels={{ less: 'Close', info: 'Details' }}
    onSelect={vi.fn()} onOpen={vi.fn()} onExpand={vi.fn()} onCollapse={vi.fn()} onInfo={onInfo} />);
  return { ...view, svg: view.container.querySelector('svg')! };
}

describe('GraphCanvas', () => {
  it('draws the info badge a third smaller than the other badges, with a full-size click target', () => {
    const { svg } = renderCanvas();
    const more = svg.querySelector('.badge-more circle')!;
    const dot = svg.querySelector('.badge-info circle.dot')!;
    const hit = svg.querySelector('.badge-info circle.hit')!;
    expect(Number(more.getAttribute('r'))).toBe(10);
    expect(Number(dot.getAttribute('r'))).toBeCloseTo(10 * (2 / 3), 5);
    expect(Number(hit.getAttribute('r'))).toBe(10);
    expect(Number(dot.getAttribute('stroke-width'))).toBeCloseTo(1.5 * (2 / 3), 5);
    expect(Number(svg.querySelector('.badge-info text')!.getAttribute('font-size'))).toBeCloseTo(13 * (2 / 3), 5);
    expect(svg.querySelector('.badge-more circle.hit')).toBeNull();
  });

  it('opens the details from the info badge, also through its larger target', () => {
    const onInfo = vi.fn();
    const { svg } = renderCanvas(onInfo);
    fireEvent.click(svg.querySelector('.badge-info circle.hit')!);
    expect(onInfo).toHaveBeenCalledWith('a');
  });

  it('draws links readable at rest and brighter while a record they touch is hovered', () => {
    const { svg } = renderCanvas();
    const line = svg.querySelector('line')!;
    expect(line.getAttribute('stroke')).toBe('rgba(255,255,255,0.55)');
    expect(Number(line.getAttribute('stroke-width'))).toBe(1.75);
    fireEvent.mouseEnter(svg.querySelector('g[role="button"][aria-label="Alpha"]')!);
    expect(line.getAttribute('stroke')).toBe('rgba(255,255,255,0.95)');
    expect(Number(line.getAttribute('stroke-width'))).toBe(3);
    fireEvent.mouseLeave(svg.querySelector('g[role="button"][aria-label="Alpha"]')!);
    expect(line.getAttribute('stroke')).toBe('rgba(255,255,255,0.55)');
  });

  it('keeps the highlight color for highlighted links', () => {
    const { svg } = renderCanvas(vi.fn(), { ids: new Set(['a', 'b']) });
    expect(svg.querySelector('line')!.getAttribute('stroke')).toBe('#fbbf24');
  });
});
