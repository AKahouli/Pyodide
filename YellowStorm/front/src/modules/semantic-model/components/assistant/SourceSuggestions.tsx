import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpRight, CheckCircle2, FileSpreadsheet, FileText, FolderOpen, Loader2, Undo2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { showError } from '@/lib/notifications';
import { parseApiError } from '@/lib/api-error';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import type { SourceSuggestion, SourceSuggestionOption } from '../../types';
import { SourceChooserDialog } from './SourceChooser';

/** Above this many files, reading a source takes long (and one AI call per file): say so before it is picked. */
const LARGE_SOURCE_FILES = 200;

/** Where the designer opens to use a suggestion, choose other files for its concept, or show them all. */
export function suggestionRoute(modelId: string, action?: { conceptKey: string; option?: number; browse?: boolean; choice?: boolean }) {
  const base = `/semantic-models/${encodeURIComponent(modelId)}`;
  if (!action) return `${base}?sources=1`;
  const query = new URLSearchParams({ suggestion: action.conceptKey });
  if (action.choice) query.set('choice', '1');
  else if (action.browse) query.set('browse', '1');
  else query.set('option', String(action.option ?? 0));
  return `${base}?${query}`;
}

/** Files chosen in a conversation, waiting for the designer to open them (same tab, so memory is enough). */
const chosenSources = new Map<string, SourceSuggestionOption>();
export function handOffChosenSource(modelId: string, conceptKey: string, option: SourceSuggestionOption) {
  chosenSources.set(`${modelId}:${conceptKey}`, option);
}
export function takeChosenSource(modelId: string, conceptKey: string) {
  const option = chosenSources.get(`${modelId}:${conceptKey}`);
  chosenSources.delete(`${modelId}:${conceptKey}`);
  return option;
}

export function useSourceSuggestions(modelId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: semanticModelQueryKeys.sourceSuggestions(modelId ?? 'none'),
    queryFn: () => semanticModelApi.sourceSuggestions(modelId!),
    enabled: Boolean(modelId) && enabled,
    retry: false,
  });
}

/**
 * The sources an assistant suggested, concept by concept. Nothing is connected from here: using a
 * suggestion opens the designer's source picker with its files already picked, to check and confirm.
 */
export function SourceSuggestionsList({ modelId, suggestions, canEdit, onUse, onBrowse }: Readonly<{
  modelId: string;
  suggestions: SourceSuggestion[];
  canEdit: boolean;
  onUse: (suggestion: SourceSuggestion, option: number) => void;
  onBrowse: (suggestion: SourceSuggestion) => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const queryClient = useQueryClient();
  const status = useMutation({
    mutationFn: ({ conceptKey, next }: { conceptKey: string; next: 'pending' | 'skipped' }) =>
      semanticModelApi.setSourceSuggestionStatus(modelId, conceptKey, next),
    onSuccess: (page) => queryClient.setQueryData(semanticModelQueryKeys.sourceSuggestions(modelId), page),
    onError: (error) => showError(t('assistantSources.statusError'), { description: parseApiError(error).message }),
  });

  return <ul className='space-y-3'>
    {suggestions.map((suggestion) => <li key={suggestion.conceptKey} className='rounded-lg border bg-background p-3'>
      <div className='flex items-center gap-2'>
        <p className='min-w-0 flex-1 truncate text-sm font-semibold'>{suggestion.conceptLabel}</p>
        {suggestion.status === 'connected' && <Badge variant='secondary' className='gap-1'><CheckCircle2 className='h-3 w-3 text-emerald-600' />{t('assistantSources.connected')}</Badge>}
        {suggestion.status === 'skipped' && <Badge variant='outline'>{t('assistantSources.skipped')}</Badge>}
      </div>
      {suggestion.note && <p className='mt-1 text-xs text-muted-foreground'>{suggestion.note}</p>}
      {suggestion.status === 'pending' && <>
        <ul className='mt-2 space-y-2'>
          {suggestion.options.map((option, index) => <li key={index} className='flex items-start gap-2 rounded-md bg-muted/40 p-2'>
            <OptionIcon option={option} />
            <div className='min-w-0 flex-1'>
              <p className='break-words text-sm font-medium'>{optionTitle(option, t)}</p>
              <p className='text-xs text-muted-foreground'>{optionCoverage(option, t)}</p>
              {option.reason && <p className='mt-0.5 text-xs italic text-muted-foreground'>{option.reason}</p>}
              {option.fileCount > LARGE_SOURCE_FILES && <p className='mt-1 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400'>
                <AlertTriangle className='mt-0.5 h-3 w-3 shrink-0' />{t('assistantSources.large', { count: option.fileCount })}
              </p>}
            </div>
            {canEdit && <Button size='sm' variant='outline' className='shrink-0' onClick={() => onUse(suggestion, index)}>{t('assistantSources.use')}</Button>}
          </li>)}
        </ul>
        {canEdit && <div className='mt-2 flex flex-wrap gap-2'>
          <Button size='sm' variant='ghost' onClick={() => onBrowse(suggestion)}><FolderOpen className='mr-1.5 h-4 w-4' />{t(suggestion.options.length ? 'assistantSources.browse' : 'assistantSources.chooseFiles')}</Button>
          <Button size='sm' variant='ghost' disabled={status.isPending} onClick={() => status.mutate({ conceptKey: suggestion.conceptKey, next: 'skipped' })}>
            <X className='mr-1.5 h-4 w-4' />{t('assistantSources.skip')}
          </Button>
        </div>}
      </>}
      {suggestion.status === 'skipped' && canEdit && <Button size='sm' variant='ghost' className='mt-1' disabled={status.isPending}
        onClick={() => status.mutate({ conceptKey: suggestion.conceptKey, next: 'pending' })}>
        <Undo2 className='mr-1.5 h-4 w-4' />{t('assistantSources.bringBack')}
      </Button>}
    </li>)}
  </ul>;
}

/** The suggestions as a card in a conversation: each choice opens the designer to check and confirm it. */
export function SourceSuggestionsCard({ modelId, modelName, onNavigate }: Readonly<{
  modelId: string;
  modelName?: string;
  onNavigate: (route: string) => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const query = useSourceSuggestions(modelId);
  const suggestions = query.data?.suggestions ?? [];
  const name = query.data?.model.name ?? modelName ?? '';
  const pending = suggestions.filter((suggestion) => suggestion.status === 'pending').length;
  const [choosingFor, setChoosingFor] = useState<SourceSuggestion | null>(null);
  return <section className='rounded-xl border bg-card p-3 shadow-sm' aria-label={t('assistantSources.title', { name })}>
    <header className='mb-3'>
      <h3 className='text-sm font-semibold'>{t('assistantSources.title', { name })}</h3>
      <p className='mt-0.5 text-xs text-muted-foreground'>{t('assistantSources.hint')}</p>
    </header>
    {query.isLoading && <p className='flex items-center gap-2 text-sm text-muted-foreground'><Loader2 className='h-4 w-4 animate-spin' />{t('assistantSources.loading')}</p>}
    {query.isError && <p className='text-sm text-muted-foreground'>{t('assistantSources.unavailable')}</p>}
    {!query.isLoading && !query.isError && <SourceSuggestionsList modelId={modelId} suggestions={suggestions} canEdit
      onUse={(suggestion, option) => onNavigate(suggestionRoute(modelId, { conceptKey: suggestion.conceptKey, option }))}
      onBrowse={setChoosingFor} />}
    <SourceChooserDialog open={Boolean(choosingFor)} modelId={modelId} conceptLabel={choosingFor?.conceptLabel ?? ''} onClose={() => setChoosingFor(null)}
      onChoose={(option) => {
        if (!choosingFor) return;
        handOffChosenSource(modelId, choosingFor.conceptKey, option);
        setChoosingFor(null);
        onNavigate(suggestionRoute(modelId, { conceptKey: choosingFor.conceptKey, choice: true }));
      }} />
    <footer className='mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3'>
      <p className='text-xs text-muted-foreground'>{pending ? t('assistantSources.pending', { count: pending }) : t('assistantSources.noneLeft')}</p>
      <Button size='sm' onClick={() => onNavigate(`/semantic-models/${encodeURIComponent(modelId)}`)}>
        {t('assistantSources.continue')}<ArrowUpRight className='ml-1.5 h-4 w-4' />
      </Button>
    </footer>
  </section>;
}

function OptionIcon({ option }: Readonly<{ option: SourceSuggestionOption }>) {
  const Icon = option.kind === 'spreadsheet' ? FileSpreadsheet : option.kind === 'document' ? FileText : FolderOpen;
  return <Icon className='mt-0.5 h-4 w-4 shrink-0 text-muted-foreground' aria-hidden='true' />;
}

type Translate = ReturnType<typeof useModuleTranslation<'semantic-model'>>['t'];

function optionTitle(option: SourceSuggestionOption, t: Translate) {
  if (option.kind === 'spreadsheet' || option.kind === 'document') {
    const file = option.documents[0] ?? t('assistantSources.aFile');
    return option.sheetName ? t('assistantSources.fileSheetIn', { file, sheet: option.sheetName, workspace: option.workspaceName }) : t('assistantSources.fileIn', { file, workspace: option.workspaceName });
  }
  if (option.kind === 'workspace') return t('assistantSources.wholeWorkspace', { workspace: option.workspaceName });
  const picked = [...option.folders, ...option.documents];
  const more = option.folderIds.length + option.documentIds.length - picked.length;
  return `${option.workspaceName} › ${picked.join(', ')}${more > 0 ? ` ${t('assistantSources.more', { count: more })}` : ''}`;
}

function optionCoverage(option: SourceSuggestionOption, t: Translate) {
  if (option.kind === 'spreadsheet') return t('assistantSources.spreadsheet');
  if (option.kind === 'document') return t('assistantSources.oneDocument');
  const files = t('assistantSources.files', { count: option.fileCount, formatted: option.fileCount.toLocaleString() });
  return option.stillIndexing ? `${files} · ${t('assistantSources.stillIndexing', { count: option.stillIndexing })}` : files;
}
