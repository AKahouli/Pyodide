// Adapted from Thesys open-intelligent-ui svg.tsx (MIT); see MINI-APP-NOTICE.txt.
import { createElement, Fragment, type ReactNode } from 'react';
import { Svg, Circle, Ellipse, Rect, Line, Path, Polyline, Polygon, G, SvgText, svgPaint } from './svg-definitions';

const withoutNulls = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null)) : value;
const paints: Record<string, string> = { foreground: 'var(--foreground)', muted: 'var(--muted-foreground)', primary: 'var(--primary)', accent: 'var(--accent-foreground)', destructive: 'var(--destructive)', ...Object.fromEntries([1, 2, 3, 4, 5].map(n => [`chart-${n}`, `var(--chart-${n})`])) };
const color = (value: string | undefined) => value && svgPaint.safeParse(value).success ? paints[value] ?? value : undefined;
type Paint = { fill?: string; stroke?: string; strokeWidth?: number; opacity?: number };
const paintAttrs = (props: Paint, filled: boolean) => ({ fill: color(props.fill) ?? (filled && !props.stroke ? 'currentColor' : 'none'), stroke: color(props.stroke) ?? (filled ? undefined : 'currentColor'), strokeWidth: props.strokeWidth ?? (filled ? undefined : 2), opacity: props.opacity, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const });

// Runtime parsing is intentional: reactive expressions can bypass schema-time validation.
export const svgComponents = [
  { ...Svg, component: ({ props }: Parameters<typeof Svg.component>[0]) => {
    const parsed = Svg.props.safeParse(withoutNulls(props)); if (!parsed.success) return null;
    const p = parsed.data; const natural = Number(p.viewBox.trim().split(/[\s,]+/)[2]);
    return <svg className='ys-openui-svg' viewBox={p.viewBox} style={{ display: 'block', width: p.width ?? '100%', maxWidth: p.width ? '100%' : Math.max(280, natural * 1.5), height: p.height ?? 'auto', color: 'var(--foreground)', overflow: 'hidden' }} role={p.title ? 'img' : undefined} aria-label={p.title} aria-hidden={p.title ? undefined : true} preserveAspectRatio='xMidYMid meet'>{p.title && <title>{p.title}</title>}{renderSvgNode(p.children, false)}</svg>;
  } },
  { ...Circle, component: ({ props }: Parameters<typeof Circle.component>[0]) => { const p = Circle.props.safeParse(withoutNulls(props)); return p.success ? <circle cx={p.data.cx} cy={p.data.cy} r={p.data.r} {...paintAttrs(p.data, true)} /> : null; } },
  { ...Ellipse, component: ({ props }: Parameters<typeof Ellipse.component>[0]) => { const p = Ellipse.props.safeParse(withoutNulls(props)); return p.success ? <ellipse cx={p.data.cx} cy={p.data.cy} rx={p.data.rx} ry={p.data.ry} {...paintAttrs(p.data, true)} /> : null; } },
  { ...Rect, component: ({ props }: Parameters<typeof Rect.component>[0]) => { const p = Rect.props.safeParse(withoutNulls(props)); return p.success ? <rect x={p.data.x} y={p.data.y} width={p.data.width} height={p.data.height} rx={p.data.rx} {...paintAttrs(p.data, true)} /> : null; } },
  { ...Line, component: ({ props }: Parameters<typeof Line.component>[0]) => { const p = Line.props.safeParse(withoutNulls(props)); return p.success ? <line x1={p.data.x1} y1={p.data.y1} x2={p.data.x2} y2={p.data.y2} {...paintAttrs(p.data, false)} /> : null; } },
  { ...Path, component: ({ props }: Parameters<typeof Path.component>[0]) => { const p = Path.props.safeParse(withoutNulls(props)); return p.success ? <path d={p.data.d} {...paintAttrs(p.data, p.data.fill !== undefined)} /> : null; } },
  { ...Polyline, component: ({ props }: Parameters<typeof Polyline.component>[0]) => { const p = Polyline.props.safeParse(withoutNulls(props)); return p.success ? <polyline points={p.data.points} {...paintAttrs(p.data, false)} /> : null; } },
  { ...Polygon, component: ({ props }: Parameters<typeof Polygon.component>[0]) => { const p = Polygon.props.safeParse(withoutNulls(props)); return p.success ? <polygon points={p.data.points} {...paintAttrs(p.data, true)} /> : null; } },
  { ...G, component: ({ props }: Parameters<typeof G.component>[0]) => { const p = G.props.safeParse(withoutNulls(props)); return p.success ? <g transform={p.data.transform} opacity={p.data.opacity}>{renderSvgNode(p.data.children, false)}</g> : null; } },
  { ...SvgText, component: ({ props }: Parameters<typeof SvgText.component>[0]) => { const p = SvgText.props.safeParse(withoutNulls(props)); return p.success ? <text x={p.data.x} y={p.data.y} fontSize={p.data.size ?? 12} fill={color(p.data.fill) ?? 'currentColor'} textAnchor={p.data.anchor ?? 'start'} fontWeight={p.data.weight === 'semibold' ? 600 : p.data.weight === 'medium' ? 500 : 400} fontFamily='inherit'>{p.data.text}</text> : null; } },
];

/** Only SVG primitives may cross this boundary; even registered Image/HTML components are excluded. */
export function renderSvgNode(value: unknown, strict = true): ReactNode {
  let count = 0;
  const visit = (node: unknown, depth: number): ReactNode => {
    const invalid = () => { if (strict) throw new Error('Invalid SVG drawing'); return null; };
    if (depth > 20 || ++count > 200) return invalid();
    if (Array.isArray(node)) return node.map((child, index) => createElement(Fragment, { key: index }, visit(child, depth + 1)));
    if (node === null || typeof node !== 'object' || !('typeName' in node) || !('props' in node)) return invalid();
    const definition = svgComponents.find(component => component.name === node.typeName);
    if (!definition || definition.name === 'Svg') return invalid();
    const parsed = definition.props.safeParse(withoutNulls(node.props));
    if (!parsed.success) return invalid();
    // Validate and render children through this same budget, never the unrestricted host renderNode.
    if (definition.name === 'G') {
      const p = G.props.parse(parsed.data);
      return <g transform={p.transform} opacity={p.opacity}>{visit(p.children, depth + 1)}</g>;
    }
    return definition.component({ props: parsed.data, renderNode: () => null } as never);
  };
  // Exports may pass a root Svg node; its children share one total budget.
  if (value && typeof value === 'object' && 'typeName' in value && value.typeName === 'Svg' && 'props' in value) {
    const parsed = Svg.props.safeParse(withoutNulls(value.props));
    if (!parsed.success) { if (strict) throw new Error('Invalid SVG drawing'); return null; }
    const p = parsed.data;
    const dimensions = p.viewBox.trim().split(/[\s,]+/).map(Number);
    return <svg xmlns='http://www.w3.org/2000/svg' viewBox={p.viewBox} width={p.width ?? dimensions[2]} height={p.height ?? dimensions[3]} role={p.title ? 'img' : undefined} aria-label={p.title} preserveAspectRatio='xMidYMid meet'>{p.title && <title>{p.title}</title>}{visit(p.children, 0)}</svg>;
  }
  return visit(value, 0);
}
