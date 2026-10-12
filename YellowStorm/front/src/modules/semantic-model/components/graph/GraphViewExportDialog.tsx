import { useState } from 'react';
import { Download, Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { parseApiError } from '@/lib/api-error';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { downloadHtml, viewFileName } from '../../export/download';
import { defaultExportMode, isModeAllowed } from '../../export/mode';
import { SVG_NODE_LIMIT, type ExportMode, type ExportStrings } from '../../export/types';
import type { GraphExportChoice } from '../../types';
import type { GraphIndex } from './graph-analytics';
import { formatValue } from './GraphRecordPanel';

/** Values in the file are cut to this many characters, as in the whole-graph export. */
const VALUE_LENGTH = 200;
type Step = 'fetching' | 'layout' | 'packing';

/**
 * Exports the records in view (with the filters, focus and expansions applied) as one HTML file that opens offline. People
 * choose how it is drawn — vector, like the app, or WebGL for large graphs — and whether values are read in.
 */
export function GraphViewExportDialog({ open, onOpenChange, index, ids, labels, modelId, dataRevisionId, colorOf, getPositions }: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  index: GraphIndex;
  /** The records in view. */
  ids: Set<string>;
  labels: Map<string, string>;
  modelId: string;
  dataRevisionId?: string;
  colorOf: (concept: string) => string;
  /** Where the graph view has placed the records it draws. */
  getPositions: () => Map<string, { x: number; y: number }> | undefined;
}>) {
  const { t, language } = useModuleTranslation('semantic-model');
  const records = ids.size;
  const [mode, setMode] = useState<ExportMode>(() => defaultExportMode(records));
  const [withValues, setWithValues] = useState(false);
  const [step, setStep] = useState<Step | null>(null);
  const [error, setError] = useState<string | null>(null);
  const svgAllowed = isModeAllowed('svg', records);
  const chosen = svgAllowed ? mode : 'sigma';
  const links = index.links.filter((link) => ids.has(link.source) && ids.has(link.target)).length;

  const strings = (): ExportStrings => ({
    search: t('graphViewer.search'), searchPlaceholder: t('graphViewer.searchPlaceholder'), searchResults: t('graphViewer.searchResults'), noMatch: t('graphViewer.noMatch'),
    legend: t('graphViewer.legend'), hideConcept: t('graphViewer.hideConcept', { concept: '{{concept}}' }), showConcept: t('graphViewer.showConcept', { concept: '{{concept}}' }),
    showAll: t('graphViewer.showAll'), fit: t('graphViewer.fit'), linkNames: t('graphViewer.linkNames'),
    showing: t('graphViewer.showing', { shown: '{{shown}}', total: '{{total}}' }), missingLegend: t('graphViewer.missingLegend'),
    fields: t('graphViewer.viewExportFields'), values: t('graphViewer.values'), valuesNotIncluded: t('graphViewer.viewExportValuesNotIncluded'), noAttributes: t('graphViewer.noAttributes'),
    missingCount: t('graphViewer.missingCount', { count: '{{count}}' as unknown as number }), missingValue: t('graphViewer.missingValue'),
    showMore: t('graphViewer.showMore'), showLess: t('graphViewer.showLess'), linked: t('graphViewer.linked'), noLinks: t('graphViewer.noLinks'),
    andMore: t('graphViewer.andMore', { count: '{{count}}' as unknown as number }),
    recordSummary: t('graphViewer.recordSummary', { filled: '{{filled}}', total: '{{total}}', links: '{{links}}' as unknown as number }),
    close: t('graphViewer.closeRecord'), centerOn: t('graphViewer.centerOn'), details: t('graphViewer.viewExportDetails'), clearSelection: t('graphViewer.viewExportClear'),
    canvasLabel: t('graphViewer.viewExportCanvasLabel', { shown: '{{shown}}' }), loading: t('graphViewer.loading'), cannotOpen: t('graphViewer.exportCannotOpen'), noWebgl: t('graphViewer.viewExportNoWebgl'),
  });

  /** Every field of every concept, shortened: the server reads the whole graph and the view keeps its own records. */
  const readValues = async () => {
    setStep('fetching');
    const fields: Record<string, Record<string, GraphExportChoice>> = {};
    for (const concept of index.concepts) {
      const sample = index.records.find((record) => record.concept === concept.key);
      fields[concept.conceptId] = Object.fromEntries((sample?.fields ?? []).map((field) => [field.key, 'short' as const]));
    }
    const content = await semanticModelApi.exportGraph(modelId, { dataRevisionId, fields, shortenTo: VALUE_LENGTH });
    return new Map(content.records.filter((record) => ids.has(record.id)).map((record) => [record.id, record.v]));
  };

  const run = async () => {
    setError(null);
    try {
      const values = withValues ? await readValues() : undefined;
      const model = await semanticModelApi.get(modelId);
      const when = new Date().toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' });
      const yes = t('graphViewer.yes');
      const no = t('graphViewer.no');
      // The drawing libraries are only fetched when someone exports.
      const { createViewExport } = await import('../../export/export-view');
      const html = await createViewExport({
        mode: chosen, index, ids, labels, colorOf, values,
        format: (field, value) => formatValue({ type: field.type, value }, language, yes, no),
        canvasPositions: getPositions(),
        onStep: setStep,
        meta: {
          title: t('graphViewer.exportTitle', { model: model.name }),
          subtitle: t('graphViewer.viewExportSubtitle', { when, records: records.toLocaleString(language), links: links.toLocaleString(language) }),
          language,
          strings: strings(),
        },
      });
      downloadHtml(html, viewFileName(model.name));
      onOpenChange(false);
    } catch (err: unknown) {
      setError(parseApiError(err).message);
    } finally {
      setStep(null);
    }
  };

  return <Dialog open={open} onOpenChange={(next) => { if (!step) onOpenChange(next); }}>
    <DialogContent className='max-w-lg'>
      <DialogHeader>
        <DialogTitle>{t('graphViewer.viewExportHeading')}</DialogTitle>
        <DialogDescription>{t('graphViewer.viewExportHelp', { records: records.toLocaleString(language), links: links.toLocaleString(language) })}</DialogDescription>
      </DialogHeader>
      <RadioGroup value={chosen} onValueChange={(value) => setMode(value as ExportMode)} aria-label={t('graphViewer.viewExportRenderer')} className='gap-3'>
        <label className={`flex items-start gap-3 text-sm ${svgAllowed ? '' : 'opacity-60'}`}>
          <RadioGroupItem value='svg' disabled={!svgAllowed} className='mt-0.5' />
          <span><span className='block font-medium'>{t('graphViewer.viewExportSvg')}</span>
            <span className='block text-xs text-muted-foreground'>{svgAllowed
              ? t('graphViewer.viewExportSvgHelp', { limit: SVG_NODE_LIMIT.toLocaleString(language) })
              : t('graphViewer.viewExportSvgTooMany', { limit: SVG_NODE_LIMIT.toLocaleString(language), records: records.toLocaleString(language) })}</span></span>
        </label>
        <label className='flex items-start gap-3 text-sm'>
          <RadioGroupItem value='sigma' className='mt-0.5' />
          <span><span className='block font-medium'>{t('graphViewer.viewExportSigma')}</span>
            <span className='block text-xs text-muted-foreground'>{t('graphViewer.viewExportSigmaHelp')}</span></span>
        </label>
      </RadioGroup>
      <label className='flex items-start gap-3 text-sm'>
        <Checkbox checked={withValues} onCheckedChange={(value) => setWithValues(value === true)} className='mt-0.5' />
        <span><span className='block font-medium'>{t('graphViewer.viewExportValues')}</span>
          <span className='block text-xs text-muted-foreground'>{t('graphViewer.viewExportValuesHelp', { length: VALUE_LENGTH })}</span></span>
      </label>
      <p className='flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300'>
        <ShieldAlert className='mt-0.5 h-4 w-4 shrink-0' />{t('graphViewer.viewExportWarning')}
      </p>
      {error && <p className='text-sm text-destructive' role='alert'>{error}</p>}
      <DialogFooter>
        {step && <span className='mr-auto flex items-center gap-2 text-sm text-muted-foreground' role='status'><Loader2 className='h-4 w-4 animate-spin' />{t(`graphViewer.exportStep_${step}`, { records: records.toLocaleString(language) })}</span>}
        <Button variant='outline' onClick={() => onOpenChange(false)} disabled={Boolean(step)}>{t('graphViewer.cancel')}</Button>
        <Button onClick={() => void run()} disabled={Boolean(step) || records === 0}><Download className='mr-1.5 h-4 w-4' />{t('graphViewer.exportRun')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
