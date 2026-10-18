import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import OpenUiRenderer from './OpenUiRenderer';
import { Circle, G, Path, Svg, SvgText, svgPaint, svgPoints, svgTransform, svgViewBox } from './svg-definitions';
import { renderSvgNode, svgComponents } from './svg';

vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key, language: 'en' }) }));

describe('scoped SVG primitives', () => {
  it('renders reactive dashboard drawings and restores typed state without agent actions', async () => {
    const user = userEvent.setup(); const update = vi.fn(); const action = vi.fn();
    const content = `root = Card([app])
$amount = 10
app = MiniApp("svg-dashboard", "Revenue", "Interactive overview", [input, picture])
input = MiniInput("amount", "Revenue", $amount, "number")
picture = Svg([bar, text, group], "0 0 200 100", null, null, "Revenue overview")
bar = Rect(0, 10, $amount, 20, "chart-1")
text = SvgText("Revenue " + $amount, 0, 60, 14, "foreground")
group = G([dot], "translate(100 20)")
dot = Circle(10, 10, 5, "primary")`;
    const props = { content, isStreaming: false, onAction: action, onStateUpdate: update };
    const view = render(<OpenUiRenderer {...props} />);
    const drawing = await screen.findByRole('img', { name: 'Revenue overview' });
    expect(drawing.querySelector('rect')).toHaveAttribute('width', '10');
    expect(drawing.querySelector('g')).toHaveAttribute('transform', 'translate(100 20)');
    await user.clear(screen.getByRole('spinbutton', { name: 'Revenue' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Revenue' }), '0');
    expect(drawing.querySelector('rect')).toHaveAttribute('width', '0');
    const state = JSON.parse(JSON.stringify(update.mock.calls.at(-1)![0]));
    view.unmount(); render(<OpenUiRenderer {...props} initialState={state} />);
    expect((await screen.findByRole('img', { name: 'Revenue overview' })).querySelector('rect')).toHaveAttribute('width', '0');
    expect(screen.getByRole('spinbutton', { name: 'Revenue' })).toHaveValue(0);
    expect(action).not.toHaveBeenCalled();
  });

  it.each(['url(https://example.com/a.svg)', 'url(#paint)', 'red;stroke:url(x)', 'var(--secret)', 'expression(alert(1))', '#fff onload=alert(1)'])('rejects resource/executable paint %s', value => {
    expect(svgPaint.safeParse(value).success).toBe(false);
  });

  it('bounds geometry, text, transforms, points and view boxes', () => {
    for (const value of [NaN, Infinity, -1, 100_001]) expect(Circle.props.safeParse({ cx: 0, cy: 0, r: value }).success).toBe(false);
    for (const value of ['translate(1e999 2)', 'translate(1 2) url(x)', 'rotate(1 2)', 'scale()', 'matrix(1,0,0,1,0,0);alert(1)']) expect(svgTransform.safeParse(value).success).toBe(false);
    for (const value of ['0 0 0 100', '0 0 -1 100', '0 0 1e999 100', '0 0 100 100 onload=x']) expect(svgViewBox.safeParse(value).success).toBe(false);
    for (const value of ['0,0 1', '0,0 Infinity,1', '0,0 100001,1']) expect(svgPoints.safeParse(value).success).toBe(false);
    for (const value of ['M0 0 L1e999 2', 'M0 0<script>', 'M0 0 url(x)', 'M0 0 L100001 2']) expect(Path.props.safeParse({ d: value }).success).toBe(false);
    expect(svgTransform.safeParse('translate(10,20) rotate(30 50 50) scale(1.5)').success).toBe(true);
    expect(Path.props.safeParse({ d: 'M0 0 C10 10, 20 20, 30 10 Z' }).success).toBe(true);
    expect(SvgText.props.safeParse({ text: 'x'.repeat(2001), x: 0, y: 0 }).success).toBe(false);
    expect(Svg.props.safeParse({ children: [], viewBox: '0 0 100 100', width: 999999 }).success).toBe(false);
  });

  it('validates reactive props again before DOM rendering, strips unregistered attributes and escapes text', () => {
    // Invoke the mounted implementation directly to exercise the post-expression boundary.
    const circle = svgComponents.find(component => component.name === 'Circle')!;
    const group = svgComponents.find(component => component.name === 'G')!;
    const text = svgComponents.find(component => component.name === 'SvgText')!;
    const invoke = (component: typeof circle, props: Record<string, unknown>) => component.component({ props, renderNode: () => null } as never);
    const view = render(<svg>{invoke(circle, { cx: 1, cy: 1, r: 5, fill: 'url(https://example.com)' })}{invoke(group, { children: [], transform: 'translate(Infinity 0)' })}{invoke(text, { text: '<script>alert(1)</script>', x: 0, y: 0, onLoad: 'alert(1)' })}</svg>);
    expect(view.container.querySelector('circle')).toBeNull();
    expect(view.container.querySelector('g')).toBeNull();
    expect(view.container.querySelector('script')).toBeNull();
    expect(view.container.querySelector('text')).toHaveTextContent('<script>alert(1)</script>');
    expect(view.container.querySelector('text')).not.toHaveAttribute('onload');
    expect(G.props.safeParse({ children: [], transform: 'translate(1 2)' }).success).toBe(true);
  });

  it('excludes non-SVG registered children and bounds nesting and total nodes', () => {
    const circle = { typeName: 'Circle', props: { cx: 1, cy: 1, r: 1 } };
    const forbidden = { typeName: 'Image', props: { src: 'https://example.com/image.png' } };
    expect(() => renderSvgNode(forbidden)).toThrow('Invalid SVG');
    const view = render(<svg>{renderSvgNode([circle, forbidden], false)}</svg>);
    expect(view.container.querySelectorAll('circle')).toHaveLength(1);
    expect(view.container.querySelector('image,img')).toBeNull();
    expect(() => renderSvgNode(Array.from({ length: 201 }, () => circle))).toThrow('Invalid SVG');
    let deep: unknown = circle;
    for (let index = 0; index < 22; index++) deep = { typeName: 'G', props: { children: [deep] } };
    expect(() => renderSvgNode(deep)).toThrow('Invalid SVG');
  });
});
