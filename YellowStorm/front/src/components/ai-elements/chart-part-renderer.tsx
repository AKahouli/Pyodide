'use client';

/**
 * Chart part renderer. Owns every recharts import so the conversation route
 * only fetches the chart bundle when a chart part actually renders
 * (ai-message-content lazy-loads this module, Phase 7 boundary).
 */

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Label, Line, LineChart, Pie, PieChart, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from 'recharts';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import type { ChartConfig } from '@/components/ui/chart';
import { useModuleTranslation } from '@/modules/localization';
import { formatLabel } from './format-label';
import type { ChartPart } from './ai-message-content';

export function ChartPartRenderer({ title, kind, data, config, xAxisKey, yAxisKey, nameKey, zAxisKey, stacked = false, layout = 'horizontal', innerRadius = 0, showLegend = true, showGrid = true, series }: ChartPart) {
  const { t: tCommon } = useModuleTranslation('common');
  const hasData = Array.isArray(data) && data.length > 0;

  if (!hasData) {
    return <div className='my-4 rounded-xl border bg-card p-4 text-sm text-muted-foreground'>{tCommon('ai.chart.noData')}</div>;
  }

  const resolvedConfig: ChartConfig = Object.fromEntries(
    Object.entries(config).map(([key, item]) => [key, { label: item.label }]),
  );
  const seriesColors = series.map((item, index) => {
    const color = item.color || config[item.dataKey]?.color || `var(--chart-${(index % 5) + 1})`;
    resolvedConfig[item.dataKey] = {
      label: config[item.dataKey]?.label || item.label || formatLabel(item.dataKey),
    };
    return color;
  });
  const showPieLegend = showLegend && kind === 'pie';

  const chartContent = (() => {
    switch (kind) {
      case 'line':
        return (
          <LineChart accessibilityLayer data={data}>
            {showGrid && <CartesianGrid vertical={false} />}
            <XAxis dataKey={xAxisKey} tickLine={false} tickMargin={10} />
            <YAxis />
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            {showLegend && <ChartLegend content={<ChartLegendContent />} />}
            {series.map((s, index) => (
              <Line key={s.dataKey} type='monotone' dataKey={s.dataKey} stroke={seriesColors[index]} dot={false} />
            ))}
          </LineChart>
        );
      case 'bar':
        return (
          <BarChart accessibilityLayer data={data} layout={layout}>
            {showGrid && <CartesianGrid vertical={layout !== 'vertical'} horizontal={layout === 'vertical'} />}
            {layout === 'vertical' ? <XAxis type='number' tickLine={false} axisLine={false} /> : <XAxis dataKey={xAxisKey} tickLine={false} tickMargin={10} />}
            {layout === 'vertical' ? <YAxis type='category' dataKey={xAxisKey} tickLine={false} axisLine={false} width={90} /> : <YAxis />}
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            {showLegend && <ChartLegend content={<ChartLegendContent />} />}
            {series.map((s, index) => (
              <Bar key={s.dataKey} dataKey={s.dataKey} fill={seriesColors[index]} radius={4} minPointSize={2} stackId={stacked ? 'stack' : undefined} />
            ))}
          </BarChart>
        );
      case 'area':
        return (
          <AreaChart accessibilityLayer data={data}>
            {showGrid && <CartesianGrid vertical={false} />}
            <XAxis dataKey={xAxisKey} tickLine={false} tickMargin={10} />
            <YAxis />
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            {showLegend && <ChartLegend content={<ChartLegendContent />} />}
            {series.map((s, index) => (
              <Area key={s.dataKey} type='monotone' dataKey={s.dataKey} fill={seriesColors[index]} stroke={seriesColors[index]} stackId={stacked ? 'stack' : undefined} />
            ))}
          </AreaChart>
        );
      case 'pie':
        return (
          <PieChart accessibilityLayer>
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            {showPieLegend && <ChartLegend content={<ChartLegendContent />} />}
            <Pie data={data} dataKey={series[0]?.dataKey || yAxisKey || 'value'} nameKey={nameKey || xAxisKey} innerRadius={innerRadius} outerRadius={90}>
              {data.map((entry, index) => {
                const colorIndex = (index % 5) + 1;
                const fill = (entry as any).fill || `var(--chart-${colorIndex})`;
                return <Cell key={`slice-${index}`} fill={fill} />;
              })}
              {innerRadius > 0 && <Label position='center'>{title || tCommon('ai.chart.donutLabel')}</Label>}
            </Pie>
          </PieChart>
        );
      case 'scatter':
        return (
          <ScatterChart accessibilityLayer>
            {showGrid && <CartesianGrid />}
            <XAxis type='number' dataKey={xAxisKey} name={xAxisKey} />
            <YAxis type='number' dataKey={yAxisKey || series[0]?.dataKey} name={yAxisKey || series[0]?.dataKey} />
            {zAxisKey && <ZAxis type='number' dataKey={zAxisKey} range={[60, 200]} />}
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            {showLegend && <ChartLegend content={<ChartLegendContent />} />}
            <Scatter name={title || tCommon('ai.chart.scatterSeries')} data={data} fill={seriesColors[0] || 'var(--chart-1)'} />
          </ScatterChart>
        );
      case 'composed':
        return (
          <ComposedChart accessibilityLayer data={data}>
            {showGrid && <CartesianGrid vertical={false} />}
            <XAxis dataKey={xAxisKey} tickLine={false} tickMargin={10} />
            <YAxis />
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            {showLegend && <ChartLegend content={<ChartLegendContent />} />}
            {series.map((s, index) => {
              const resolvedKind = s.kind || 'bar';
              if (resolvedKind === 'line') {
                return <Line key={s.dataKey} type='monotone' dataKey={s.dataKey} stroke={seriesColors[index]} dot={false} />;
              }
              if (resolvedKind === 'area') {
                return <Area key={s.dataKey} type='monotone' dataKey={s.dataKey} fill={seriesColors[index]} stroke={seriesColors[index]} />;
              }
              return <Bar key={s.dataKey} dataKey={s.dataKey} fill={seriesColors[index]} radius={4} minPointSize={2} />;
            })}
          </ComposedChart>
        );
      default:
        return <div className='flex items-center justify-center h-full text-destructive text-sm'>Unknown chart kind: {kind}</div>;
    }
  })();

  return (
    <div className='my-4 rounded-xl border bg-card text-card-foreground shadow w-full' role='figure' aria-label={title || tCommon('ai.chart.a11yLabel')}>
      {title && (
        <div className='p-4 border-b'>
          <h3 className='font-semibold leading-none tracking-tight'>{title}</h3>
        </div>
      )}
      <div className='p-4'>
        <ChartContainer config={resolvedConfig} className='aspect-auto h-[250px] w-full min-w-0'>
          {chartContent}
        </ChartContainer>
      </div>
    </div>
  );
}
