import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { parseApiError } from '@/lib/api-error';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { waitForGraphSave } from '../../store';
import type { DocumentFieldSuggestion, SemanticNodeType, StructuredSourceAsset } from '../../types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../common/Select';
import { FormField, INPUT } from '../form/FormParts';

type Proposal = DocumentFieldSuggestion & { selected: boolean };

/** Proposals stay local until the person explicitly applies their selection. */
export function DocumentFieldSuggestions({ modelId, concept, sources, disabled, onApply, onEvidence }: Readonly<{
  modelId: string;
  concept: SemanticNodeType;
  sources: StructuredSourceAsset[];
  disabled?: boolean;
  onApply: (fields: DocumentFieldSuggestion[], purpose: string) => void;
  onEvidence: (evidence: DocumentFieldSuggestion['evidence'][number]) => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const [open, setOpen] = useState(false);
  const [purpose, setPurpose] = useState(concept.description);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [applied, setApplied] = useState(false);
  // One source authorization scope per request; workspace mapping supplies its covered sample files.
  const sample = sources.filter((source) => source.workspaceId === sources[0]?.workspaceId).slice(0, 5);
  const scope = sample.map((source) => `${source.workspaceId}/${source.documentId}`).join('|');
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const discover = useMutation({
    mutationFn: async (_scope: string) => { await waitForGraphSave(); return semanticModelApi.suggestDocumentFields(modelId, {
      conceptId: concept.id, workspaceId: sample[0].workspaceId,
      documentIds: sample.map((source) => source.documentId), description: purpose.trim(),
    }); },
    onSuccess: (result, requestScope) => {
      if (requestScope !== scopeRef.current) return;
      setProposals(result.suggestions.map((item) => ({ ...item,
        description: item.mapping.semanticDefinition?.trim() || item.description,
        selected: !concept.attributes.some((attribute) => attribute.key === item.key),
      })));
      setApplied(false);
    },
  });
  useEffect(() => { setProposals([]); discover.reset(); setApplied(false); }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps
  const edit = (index: number, changes: Partial<Proposal>) => setProposals((current) => current.map((item, at) => at === index ? { ...item, ...changes } : item));
  const selected = proposals.filter((item) => item.selected);
  const valid = selected.length > 0 && selected.every((item) => item.label.trim() && item.description.trim());
  return <section className='space-y-3' aria-label={t('fieldDiscovery.title')}>
    <Button variant='outline' size='sm' aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <Sparkles className='me-2 h-4 w-4' />{t('fieldDiscovery.title')}
    </Button>
    {open && <div className='space-y-4 border-y py-4'>
      <p className='text-sm text-muted-foreground'>{t('fieldDiscovery.help')}</p>
      <FormField label={t('fieldDiscovery.purpose')}>
        <Textarea value={purpose} maxLength={2000} disabled={discover.isPending} aria-label={t('fieldDiscovery.purpose')}
          placeholder={t('fieldDiscovery.purposePlaceholder')} onChange={(event) => {
            setPurpose(event.target.value); setProposals([]); discover.reset(); setApplied(false);
          }} />
      </FormField>
      <p className='text-xs text-muted-foreground'>{t('fieldDiscovery.sample', { count: sample.length })}</p>
      <Button size='sm' disabled={disabled || !sample.length || !purpose.trim() || discover.isPending} onClick={() => discover.mutate(scope)}>
        {discover.isPending ? <Loader2 className='me-2 h-4 w-4 animate-spin' /> : <Sparkles className='me-2 h-4 w-4' />}
        {t(discover.isPending ? 'fieldDiscovery.analyzing' : 'fieldDiscovery.analyze')}
      </Button>
      {discover.isError && <p role='alert' className='text-sm text-destructive'>{t('fieldDiscovery.error', { detail: parseApiError(discover.error).message })}</p>}
      {discover.data && <>
        <p role='status' className='text-xs text-muted-foreground'>{t('fieldDiscovery.coverage', {
          read: discover.data.documentsRead, total: discover.data.documentsRequested, skipped: discover.data.unread.length,
        })}{discover.data.truncated && ` ${t('fieldDiscovery.truncated')}`}</p>
        {proposals.length === 0 && <p className='text-sm'>{t('fieldDiscovery.empty')}</p>}
        <ul className='divide-y'>
          {proposals.map((item, index) => <li key={item.key} className='space-y-3 py-4'>
            <div className='flex items-center gap-2'>
              <input type='checkbox' checked={item.selected} disabled={applied} aria-label={t('fieldDiscovery.include', { field: item.label })}
                onChange={(event) => edit(index, { selected: event.target.checked })} />
              <Input className={INPUT} value={item.label} maxLength={200} disabled={applied || concept.attributes.some((attribute) => attribute.key === item.key)} aria-label={t('fieldDiscovery.fieldName', { field: item.key })}
                onChange={(event) => edit(index, { label: event.target.value })} />
            </div>
            <p className='text-xs text-muted-foreground'>{item.key} · {t(concept.attributes.some((attribute) => attribute.key === item.key) ? 'fieldDiscovery.existing' : 'fieldDiscovery.newField')}</p>
            <div className='grid gap-3 sm:grid-cols-2'>
              <FormField label={t('fieldDiscovery.type')}>
                <Select value={item.type} disabled={applied || item.mapping.mode === 'metadata' || concept.attributes.some((attribute) => attribute.key === item.key)} onValueChange={(value) => {
                  // A rule was checked for its original type. A changed type needs a new AI read.
                  const { rules: _rules, ...mapping } = item.mapping;
                  edit(index, { type: value as Proposal['type'], mapping: { ...mapping, extractionStrategy: 'ai' } });
                }}>
                  <SelectTrigger className={INPUT} aria-label={t('fieldDiscovery.typeFor', { field: item.label })}><SelectValue /></SelectTrigger>
                  <SelectContent>{(['text', 'number', 'boolean', 'date'] as const).map((type) => <SelectItem key={type} value={type}>{t(`attribute.type.${type}`)}</SelectItem>)}</SelectContent>
                </Select>
              </FormField>
              <FormField label={t('fieldDiscovery.method')}>
                {item.mapping.mode === 'metadata' ? <p className='py-2 text-sm'>{t('fieldDiscovery.metadata')}</p> : <Select value={item.mapping.extractionStrategy ?? 'ai'} disabled={applied}
                  onValueChange={(value) => edit(index, { mapping: { ...item.mapping, extractionStrategy: value as 'deterministic' | 'rules_then_ai' | 'ai' } })}>
                  <SelectTrigger className={INPUT} aria-label={t('fieldDiscovery.methodFor', { field: item.label })}><SelectValue /></SelectTrigger>
                  <SelectContent>{(['deterministic', 'rules_then_ai', 'ai'] as const).map((method) => <SelectItem key={method} value={method} disabled={method !== 'ai' && !item.mapping.rules}>{t(`mapping.strategy.${method}`)}</SelectItem>)}</SelectContent>
                </Select>}
              </FormField>
            </div>
            <Textarea value={item.description} maxLength={2000} disabled={applied} aria-label={t('fieldDiscovery.definitionFor', { field: item.label })}
              onChange={(event) => edit(index, { description: event.target.value })} />
            {item.mapping.rules?.labels?.length ? <p className='text-xs'>{t('fieldDiscovery.rule', { labels: item.mapping.rules.labels.join(', ') })}</p> : null}
            <p className='text-xs text-muted-foreground'>{t('fieldDiscovery.matches', { count: item.matchedDocuments, total: discover.data.documentsRead })}</p>
            {item.evidence.map((evidence, at) => <div key={at} className='space-y-1 text-xs'>
              <blockquote className='whitespace-pre-wrap break-words text-muted-foreground'>{evidence.quote}</blockquote>
              <Button variant='link' className='h-auto max-w-full whitespace-normal p-0 text-start text-xs' onClick={() => onEvidence(evidence)}>
                {evidence.filename}{evidence.page ? ` · ${t('fieldDiscovery.page', { page: evidence.page })}` : ''}
              </Button>
            </div>)}
          </li>)}
        </ul>
        {proposals.length > 0 && <>
          <p className='text-xs text-muted-foreground'>{t('fieldDiscovery.applyHelp')}</p>
          <Button size='sm' disabled={disabled || applied || !valid} onClick={() => { onApply(selected, purpose.trim()); setApplied(true); }}>
            {t('fieldDiscovery.apply', { count: selected.length })}
          </Button>
        </>}
        {applied && <p role='status' className='text-sm'>{t('fieldDiscovery.applied')}</p>}
      </>}
    </div>}
  </section>;
}
