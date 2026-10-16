import { useContext, useEffect } from 'react';
import { useGetFieldValue, useSetFieldValue, useTriggerAction, useIsStreaming } from '@openuidev/react-lang';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import type { StockComponent } from './inline-text';
import { OpenUiSubmissionContext } from './actions';
import { getChartData, type ChartView } from './data-exploration';

export function withChartExplorer(Stock: StockComponent): StockComponent {
  return function ChartExplorer(args) {
    const getValue = useGetFieldValue(); const setValue = useSetFieldValue(); const trigger = useTriggerAction();
    const streaming = useIsStreaming(); const statuses = useContext(OpenUiSubmissionContext);
    const { t } = useModuleTranslation('conversation');
    const id = args.statementId; const key = `chart:${id}`;
    const labels = args.props.labels as string[] | undefined;
    const series = args.props.series as { category: string; values: number[] }[] | undefined;
    const data = getChartData(labels ?? [], series ?? [], getValue('__ysExplore', key));
    useEffect(() => {
      if (id && !streaming && getValue('__ysExplore', key) === undefined) setValue('__ysExplore', 'ChartView', key, { seriesIndex: -1, labelIndex: null }, false);
    }, [id, key, streaming, getValue, setValue]);
    if (!id || !labels?.length || !series?.length) return <Stock {...args} />;
    const update = (view: ChartView) => setValue('__ysExplore', 'ChartView', key, view, false);
    const labelIndices = data.view.labelIndex === null ? labels.map((_, index) => index) : [data.view.labelIndex];
    const seriesIndices = data.view.seriesIndex < 0 ? series.map((_, index) => index) : [data.view.seriesIndex];
    const selectClass = 'h-9 max-w-full rounded-md border border-input bg-background px-3 text-sm';
    return <fieldset disabled={streaming || statuses.__ysExplore === 'submitting'} className='m-0 min-w-0 space-y-3 border-0 p-0'>
      <div className='flex flex-wrap gap-2'>
        <label className='flex min-w-0 flex-col gap-1 text-sm'>{t('openui.explore.series')}
          <select className={selectClass} value={data.view.seriesIndex} onChange={event => update({ ...data.view, seriesIndex: Number(event.target.value) })}>
            <option value={-1}>{t('openui.explore.allSeries')}</option>
            {series.map((entry, index) => <option key={index} value={index}>{entry.category}</option>)}
          </select>
        </label>
        <label className='flex min-w-0 flex-col gap-1 text-sm'>{t('openui.explore.category')}
          <select className={selectClass} value={data.view.labelIndex ?? ''} onChange={event => update({ ...data.view, labelIndex: event.target.value === '' ? null : Number(event.target.value) })}>
            <option value=''>{t('openui.explore.allCategories')}</option>
            {labels.map((label, index) => <option key={index} value={index}>{label}</option>)}
          </select>
        </label>
      </div>
      <Stock {...args} props={{ ...args.props, labels: data.labels, series: data.series }} />
      <div className='flex flex-wrap gap-2' aria-label={t('openui.explore.drillDown')}>
        {labels.map((label, index) => <Button size='sm' variant={data.view.labelIndex === index ? 'secondary' : 'outline'} key={index}
          aria-pressed={data.view.labelIndex === index} onClick={() => update({ ...data.view, labelIndex: data.view.labelIndex === index ? null : index })}>{label}</Button>)}
      </div>
      <p aria-live='polite' className='text-sm text-muted-foreground'>{labelIndices.map(index => `${labels[index]}: ${seriesIndices.map(seriesIndex => `${series[seriesIndex].category} ${series[seriesIndex].values[index]}`).join(', ')}`).join(' · ')}</p>
      <Button size='sm' variant='outline' onClick={() => void trigger(t('openui.explore.applyChart', { name: id }), '__ysExplore', {
        type: 'continue_conversation', params: { chart: id, ...data.view, selectedPoints: labelIndices.flatMap(labelIndex => seriesIndices.map(seriesIndex => ({
          seriesIndex, labelIndex, label: labels[labelIndex], category: series[seriesIndex].category, value: series[seriesIndex].values[labelIndex],
        }))) },
      })}>{t('openui.explore.applyChart', { name: id })}</Button>
      {statuses.__ysExplore && <p role='status' className='text-xs text-muted-foreground'>{t(`openui.interaction.${statuses.__ysExplore}`)}</p>}
    </fieldset>;
  };
}
