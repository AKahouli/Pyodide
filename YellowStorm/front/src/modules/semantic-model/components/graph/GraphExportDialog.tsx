import { useMemo, useState } from 'react';
import { Download, Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { parseApiError } from '@/lib/api-error';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import type { GraphExportChoice } from '../../types';
import type { GraphIndex } from './graph-analytics';

interface FieldChoice { include: boolean; shorten: boolean }
type Step = 'fetching' | 'packing';

const fileName = (title: string) => `${title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'graph'}-${new Date().toISOString().slice(0, 10)}.html`;

/**
 * Exports the whole data graph as one HTML file people can open without the app. Each field can be left out or kept
 * whole; by default every field is in, cut to 200 characters.
 */
export function GraphExportDialog({ open, onOpenChange, index, modelId, dataRevisionId, colorOf, drawLimit, maxDraw }: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  index: GraphIndex;
  modelId: string;
  dataRevisionId?: string;
  colorOf: (concept: string) => string;
  drawLimit: number;
  maxDraw: number;
}>) {
  const { t, language } = useModuleTranslation('semantic-model');
  // Each concept's fields, from one of its records.
  const concepts = useMemo(() => index.concepts.map((concept) => {
    const sample = index.records.find((record) => record.concept === concept.key);
    return { ...concept, conceptId: sample?.conceptId ?? concept.key, fields: sample?.fields.map((field) => ({ key: field.key, label: field.label })) ?? [] };
  }), [index]);
  const [choices, setChoices] = useState<Record<string, Record<string, FieldChoice>>>({});
  const [shortenTo, setShortenTo] = useState(200);
  const [step, setStep] = useState<Step | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choiceOf = (concept: string, field: string): FieldChoice => choices[concept]?.[field] ?? { include: true, shorten: true };
  const setChoice = (concept: string, field: string, change: Partial<FieldChoice>) =>
    setChoices((current) => ({ ...current, [concept]: { ...current[concept], [field]: { ...choiceOf(concept, field), ...change } } }));
  const setConcept = (concept: string, include: boolean) => setChoices((current) => ({
    ...current,
    [concept]: Object.fromEntries((concepts.find((item) => item.key === concept)?.fields ?? []).map((field) => [field.key, { ...choiceOf(concept, field.key), include }])),
  }));
  const valid = Number.isInteger(shortenTo) && shortenTo >= 20 && shortenTo <= 100_000;

  const run = async () => {
    setError(null);
    setStep('fetching');
    try {
      const byKey: Record<string, Record<string, GraphExportChoice>> = {};
      const byId: Record<string, Record<string, GraphExportChoice>> = {};
      for (const concept of concepts) {
        byKey[concept.key] = Object.fromEntries(concept.fields.map((field) => {
          const choice = choiceOf(concept.key, field.key);
          return [field.key, !choice.include ? 'exclude' : choice.shorten ? 'short' : 'full'];
        }));
        byId[concept.conceptId] = byKey[concept.key];
      }
      const content = await semanticModelApi.exportGraph(modelId, { dataRevisionId, fields: byId, shortenTo });
      const { buildExportHtml } = await import('./graph-export');
      const when = new Date(content.exportedAt).toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' });
      const blob = await buildExportHtml(content, index, {
        title: t('graphViewer.exportTitle', { model: content.modelName }),
        subtitle: t('graphViewer.exportSubtitle', { who: content.exportedBy, when, records: content.records.length, links: content.links.length }),
        language,
        colorOf,
        choices: byKey,
        drawLimit,
        maxDraw,
        onProgress: setStep,
        strings: {
          search: t('graphViewer.search'), searchPlaceholder: t('graphViewer.searchPlaceholder'), noMatch: t('graphViewer.noMatch'),
          values: t('graphViewer.values'), noValues: t('graphViewer.noAttributes'), linked: t('graphViewer.linked'), noLinks: t('graphViewer.noLinks'),
          missingCount: t('graphViewer.missingCount', { count: '{{count}}' as unknown as number }), missingValue: t('graphViewer.missingValue'),
          showMore: t('graphViewer.showMore'), showLess: t('graphViewer.showLess'), close: t('graphViewer.closeRecord'), centerOn: t('graphViewer.centerOn'),
          fit: t('graphViewer.fit'), linkNames: t('graphViewer.linkNames'), neighboursOnly: t('graphViewer.neighboursOnly'), showAll: t('graphViewer.showAll'),
          andMore: t('graphViewer.andMore', { count: '{{count}}' as unknown as number }),
          recordSummary: t('graphViewer.recordSummary', { filled: '{{filled}}', total: '{{total}}', links: '{{links}}' as unknown as number }),
          yes: t('graphViewer.yes'), no: t('graphViewer.no'), loading: t('graphViewer.loading'), cannotOpen: t('graphViewer.exportCannotOpen'),
          tooManyToDraw: t('graphViewer.tooManyToDraw', { records: '{{records}}', limit: '{{limit}}' }),
          drawAll: t('graphViewer.drawAll', { records: '{{records}}' }),
          showing: t('graphViewer.showing', { shown: '{{shown}}', total: '{{total}}' }),
        },
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName(content.modelName);
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      onOpenChange(false);
    } catch (err: unknown) {
      setError(parseApiError(err).message);
    } finally {
      setStep(null);
    }
  };

  return <Dialog open={open} onOpenChange={(next) => { if (!step) onOpenChange(next); }}>
    <DialogContent className='max-w-2xl'>
      <DialogHeader>
        <DialogTitle>{t('graphViewer.exportHeading')}</DialogTitle>
        <DialogDescription>{t('graphViewer.exportHelp', { records: index.records.length, links: index.links.length })}</DialogDescription>
      </DialogHeader>
      <label className='flex items-center gap-2 text-sm'>
        {t('graphViewer.exportShortenTo')}
        <input type='number' min={20} max={100000} value={shortenTo} onChange={(event) => setShortenTo(Number(event.target.value))}
          className='h-8 w-24 rounded-md border border-input bg-background px-2 text-sm' aria-label={t('graphViewer.exportShortenTo')} />
        {t('graphViewer.exportCharacters')}
      </label>
      <div className='max-h-[50vh] space-y-3 overflow-y-auto rounded-md border p-3'>
        {concepts.map((concept) => {
          const all = concept.fields.every((field) => choiceOf(concept.key, field.key).include);
          const none = concept.fields.every((field) => !choiceOf(concept.key, field.key).include);
          return <fieldset key={concept.key} className='space-y-1'>
            <legend className='flex w-full items-center gap-2 text-sm font-medium'>
              <Checkbox checked={all ? true : none ? false : 'indeterminate'} onCheckedChange={(value) => setConcept(concept.key, value === true)} aria-label={t('graphViewer.exportAllFields', { concept: concept.label })} />
              <span className='h-2.5 w-2.5 rounded-full' style={{ background: colorOf(concept.key) }} />
              {concept.label}<span className='text-xs font-normal text-muted-foreground'>{concept.count.toLocaleString(language)}</span>
            </legend>
            <ul className='ml-6 grid gap-x-6 gap-y-1 sm:grid-cols-2'>
              {concept.fields.map((field) => {
                const choice = choiceOf(concept.key, field.key);
                return <li key={field.key} className='flex items-center gap-2 text-sm'>
                  <Checkbox checked={choice.include} onCheckedChange={(value) => setChoice(concept.key, field.key, { include: value === true })} aria-label={t('graphViewer.exportInclude', { field: field.label })} />
                  <span className={`min-w-0 flex-1 truncate ${choice.include ? '' : 'text-muted-foreground line-through'}`} title={field.key}>{field.label}</span>
                  <label className={`flex shrink-0 items-center gap-1 text-xs ${choice.include ? 'text-muted-foreground' : 'invisible'}`}>
                    <Checkbox checked={choice.shorten} disabled={!choice.include} onCheckedChange={(value) => setChoice(concept.key, field.key, { shorten: value === true })} aria-label={t('graphViewer.exportShorten', { field: field.label })} />
                    {t('graphViewer.exportShortenShort', { length: shortenTo })}
                  </label>
                </li>;
              })}
            </ul>
          </fieldset>;
        })}
      </div>
      <p className='flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300'>
        <ShieldAlert className='mt-0.5 h-4 w-4 shrink-0' />{t('graphViewer.exportWarning')}
      </p>
      {error && <p className='text-sm text-destructive' role='alert'>{error}</p>}
      <DialogFooter>
        {step && <span className='mr-auto flex items-center gap-2 text-sm text-muted-foreground' role='status'><Loader2 className='h-4 w-4 animate-spin' />{t(`graphViewer.exportStep_${step}`, { records: index.records.length })}</span>}
        <Button variant='outline' onClick={() => onOpenChange(false)} disabled={Boolean(step)}>{t('graphViewer.cancel')}</Button>
        <Button onClick={() => void run()} disabled={Boolean(step) || !valid}><Download className='mr-1.5 h-4 w-4' />{t('graphViewer.exportRun')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
