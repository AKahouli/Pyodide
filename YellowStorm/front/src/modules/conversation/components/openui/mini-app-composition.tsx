// Layout algorithms adapted from Thesys open-intelligent-ui (MIT); see MINI-APP-NOTICE.txt.
import type { CSSProperties } from 'react';
import { MiniRow, MiniColumn, MiniGrid, MiniPanel, MiniText } from './mini-app-definitions';
import { CitationMarkdown } from './citations';
import './mini-app.css';

const flex = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch', between: 'space-between' };
const bounded = (value: number, min: number, max: number, fallback: number) => Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
const spacing = (value: number) => bounded(value, 0, 12, 3) * 4;
export const miniAppCompositionComponents = [
  { ...MiniRow, component: ({ props, renderNode }: Parameters<typeof MiniRow.component>[0]) =>
    <div className='ys-mini-row' style={{ gap: spacing(props.gap), alignItems: flex[props.align], justifyContent: flex[props.justify], flexWrap: props.wrap ? 'wrap' : 'nowrap' }}>{renderNode(props.children)}</div> },
  { ...MiniColumn, component: ({ props, renderNode }: Parameters<typeof MiniColumn.component>[0]) =>
    <div className='ys-mini-column' style={{ gap: spacing(props.gap), alignItems: flex[props.align] }}>{renderNode(props.children)}</div> },
  { ...MiniGrid, component: ({ props, renderNode }: Parameters<typeof MiniGrid.component>[0]) => {
    const gap = spacing(props.gap); const columns = bounded(props.columns, 1, 6, 2);
    const minimum = props.minChildWidth ? `max(${bounded(props.minChildWidth, 80, 640, 240)}px, (100% - ${(columns - 1) * gap}px) / ${columns})` : undefined;
    return <div className='ys-mini-grid' style={{ gap, gridTemplateColumns: minimum ? `repeat(auto-fit, minmax(min(100%, ${minimum}), 1fr))` : `repeat(${columns}, minmax(0, 1fr))` }}>{renderNode(props.children)}</div>;
  } },
  { ...MiniPanel, component: ({ props, renderNode }: Parameters<typeof MiniPanel.component>[0]) =>
    <div className='ys-mini-panel' data-surface={props.surface} data-width={props.width} data-radius={props.radius} style={{ padding: spacing(props.padding), gap: spacing(props.gap) }}>{renderNode(props.children)}</div> },
  { ...MiniText, component: ({ props }: Parameters<typeof MiniText.component>[0]) => {
    const style: CSSProperties = { textAlign: props.align };
    return props.kind === 'heading'
      ? <h4 className='ys-mini-text' data-kind={props.kind} data-tone={props.tone} style={style}><CitationMarkdown inline textMarkdown={props.text} /></h4>
      : <div className='ys-mini-text' data-kind={props.kind} data-tone={props.tone} style={style}><CitationMarkdown inline textMarkdown={props.text} /></div>;
  } },
];
