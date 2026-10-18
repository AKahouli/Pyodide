// Adapted from Thesys open-intelligent-ui svg.tsx (MIT); see MINI-APP-NOTICE.txt.
// Shared schemas keep prompt generation independent of the browser renderer.
import { defineComponent } from '@openuidev/react-lang';
import { z } from 'zod/v4';

const coordinate = z.number().finite().min(-100_000).max(100_000);
const dimension = z.number().finite().min(0).max(100_000);
const numberToken = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
const numbers = (value: string) => value.trim().split(/[\s,]+/).filter(Boolean);
const boundedNumbers = (value: string) => numbers(value).every(token => new RegExp(`^${numberToken}$`).test(token) && Math.abs(Number(token)) <= 100_000);
const transformArgs: Record<string, number[]> = { translate: [1, 2], rotate: [1, 3], scale: [1, 2], skewX: [1], skewY: [1], matrix: [6] };
export const svgTransform = z.string().max(500).refine(value => {
  const parts = [...value.matchAll(/\s*([a-zA-Z]+)\(([^()]*)\)\s*/g)];
  return parts.length > 0 && parts.map(part => part[0]).join('') === value
    && parts.every(([, name, args]) => transformArgs[name]?.includes(numbers(args).length) && boundedNumbers(args));
});
export const svgPaint = z.string().max(40).regex(/^(?:none|currentColor|foreground|muted|primary|accent|destructive|chart-[1-5]|#[\da-fA-F]{3}|#[\da-fA-F]{6}|#[\da-fA-F]{8})$/);
export const svgPoints = z.string().max(20_000).refine(value => numbers(value).length >= 4 && numbers(value).length % 2 === 0 && boundedNumbers(value));
export const svgPath = z.string().min(1).max(20_000).refine(value => {
  if (!/^[MmLlHhVvCcSsQqTtAaZz\d\s,.eE+-]+$/.test(value) || !/^\s*[Mm]/.test(value)) return false;
  // Reject malformed/non-finite numeric tokens even when the character whitelist passes.
  return boundedNumbers(value.replace(/[MmLlHhVvCcSsQqTtAaZz]/g, ' '));
});
export const svgViewBox = z.string().max(100).refine(value => {
  const values = numbers(value);
  return values.length === 4 && boundedNumbers(value) && Number(values[2]) > 0 && Number(values[3]) > 0;
});
const children = z.array(z.unknown()).max(200);
const paint = { fill: svgPaint.optional(), stroke: svgPaint.optional(), strokeWidth: z.number().finite().min(0).max(1000).optional(), opacity: z.number().finite().min(0).max(1).optional() };
export const Svg = defineComponent({ name: 'Svg', description: 'Responsive SVG drawing; shapes and text accept reactive expressions. Supply a title in the user language for meaningful drawings, otherwise decorative. Semantic paints foreground, muted, primary, accent, destructive, chart-1 through chart-5; hex colors allowed. No HTML or resource URLs.', props: z.object({ children, viewBox: svgViewBox, width: z.number().finite().min(1).max(2400).optional(), height: z.number().finite().min(1).max(2400).optional(), title: z.string().min(1).max(300).optional() }), component: () => null });
export const Circle = defineComponent({ name: 'Circle', description: 'Filled circle.', props: z.object({ cx: coordinate, cy: coordinate, r: dimension, ...paint }), component: () => null });
export const Ellipse = defineComponent({ name: 'Ellipse', description: 'Filled ellipse.', props: z.object({ cx: coordinate, cy: coordinate, rx: dimension, ry: dimension, ...paint }), component: () => null });
export const Rect = defineComponent({ name: 'Rect', description: 'Filled rectangle.', props: z.object({ x: coordinate, y: coordinate, width: dimension, height: dimension, ...paint, rx: dimension.optional() }), component: () => null });
export const Line = defineComponent({ name: 'Line', description: 'Straight stroke.', props: z.object({ x1: coordinate, y1: coordinate, x2: coordinate, y2: coordinate, stroke: svgPaint.optional(), strokeWidth: paint.strokeWidth, opacity: paint.opacity }), component: () => null });
export const Path = defineComponent({ name: 'Path', description: 'SVG path commands with whitespace/comma-separated numbers; maximum 20000 characters. Unfilled unless fill is supplied.', props: z.object({ d: svgPath, ...paint }), component: () => null });
export const Polyline = defineComponent({ name: 'Polyline', description: 'Connected strokes; points like "0,0 10,5 20,0".', props: z.object({ points: svgPoints, ...paint }), component: () => null });
export const Polygon = defineComponent({ name: 'Polygon', description: 'Filled closed shape; pairs of x,y points.', props: z.object({ points: svgPoints, ...paint }), component: () => null });
export const G = defineComponent({ name: 'G', description: 'Group shapes with translate, rotate, scale, skewX, skewY or matrix transform.', props: z.object({ children, transform: svgTransform.optional(), opacity: paint.opacity }), component: () => null });
export const SvgText = defineComponent({ name: 'SvgText', description: 'Escaped SVG text in the user language.', props: z.object({ text: z.string().max(2000), x: coordinate, y: coordinate, size: z.number().finite().min(1).max(200).optional(), fill: svgPaint.optional(), anchor: z.enum(['start', 'middle', 'end']).optional(), weight: z.enum(['normal', 'medium', 'semibold']).optional() }), component: () => null });
export const svgDefinitions = [Svg, Circle, Ellipse, Rect, Line, Path, Polyline, Polygon, G, SvgText];
