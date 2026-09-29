import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SearchSelect } from '@/components/ui/search-select';
import { AssistantMarkdown } from '@/components/ai-elements/assistant-response';
import { useModuleTranslation } from '@/modules/localization';
import { useAgents } from '@/modules/agent';
import { parseApiError } from '@/lib/api-error';
import { evaluationLogicalSearchApi } from '../api';
import type { EvaluationNarrative } from '../types';

interface Props {
  evaluationId: string;
  status: string;
}

function NarrativeBlock({ title, text }: { title: string; text: string }) {
  if (!text.trim()) return null;
  return (
    <div>
      <p className='font-medium'>{title}</p>
      <AssistantMarkdown className='text-sm text-muted-foreground'>{text}</AssistantMarkdown>
    </div>
  );
}

function NarrativeList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className='font-medium'>{title}</p>
      <ul className='list-disc space-y-1 pl-5 text-muted-foreground'>
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function EvaluationNarrativePanel({ evaluationId, status }: Props): JSX.Element {
  const { t, language } = useModuleTranslation('evaluation-logical-search');
  const agents = useAgents();
  const [report, setReport] = useState<EvaluationNarrative | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    evaluationLogicalSearchApi
      .getReport(evaluationId)
      .then((res) => {
        if (cancelled) return;
        setReport(res.report);
        setSelectedAgentId(res.defaultAgentId ?? '');
      })
      .catch((err) => { if (!cancelled) setError(parseApiError(err).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [evaluationId]);

  const canGenerate = status === 'completed' || status === 'failed';

  const handleGenerate = useCallback(async () => {
    if (!selectedAgentId) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await evaluationLogicalSearchApi.generateReport(evaluationId, selectedAgentId, language);
      setReport(res.report);
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setGenerating(false);
    }
  }, [evaluationId, selectedAgentId, language]);

  const sections = report?.sections;

  return (
    <section className='space-y-4 border-t pt-4'>
      <div>
        <h3 className='text-base font-semibold'>{t('results.narrative.title')}</h3>
        <p className='text-xs text-muted-foreground'>{t('results.narrative.help')}</p>
      </div>

      {canGenerate && (
        <div className='flex flex-wrap items-end gap-3'>
          <div className='min-w-52 flex-1 space-y-1'>
            <label className='text-sm font-medium'>{t('results.narrative.agent')}</label>
            <SearchSelect
              options={agents.map((a) => ({ value: a.id, label: a.name }))}
              value={selectedAgentId}
              onValueChange={setSelectedAgentId}
              placeholder={t('results.narrative.agentPlaceholder')}
              searchPlaceholder={t('select.search')}
              emptyText={t('select.noResults')}
            />
          </div>
          <Button onClick={() => void handleGenerate()} disabled={!selectedAgentId || generating}>
            {generating
              ? t('results.narrative.generating')
              : report
                ? t('results.narrative.regenerate')
                : t('results.narrative.generate')}
          </Button>
        </div>
      )}

      {loading && <p className='text-sm text-muted-foreground'>{t('results.narrative.loading')}</p>}
      {error && <p className='text-sm text-destructive'>{error}</p>}

      {!loading && !error && !report && (
        <p className='text-sm text-muted-foreground'>
          {canGenerate ? t('results.narrative.empty') : t('results.narrative.unavailable')}
        </p>
      )}

      {sections && (
        <div className='space-y-4 text-sm leading-relaxed'>
          <NarrativeBlock title={t('results.narrative.overview')} text={sections.overview} />
          <NarrativeBlock title={t('results.narrative.performance')} text={sections.performance} />
          <NarrativeBlock title={t('results.narrative.retrieval')} text={sections.retrieval} />
          <NarrativeBlock title={t('results.narrative.tokens')} text={sections.tokens} />
          <NarrativeList title={t('results.narrative.strengths')} items={sections.strengths} />
          <NarrativeList title={t('results.narrative.improvements')} items={sections.improvements} />
          <NarrativeList title={t('results.narrative.caveats')} items={sections.caveats} />
        </div>
      )}
    </section>
  );
}
