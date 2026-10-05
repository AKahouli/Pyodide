import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { parseApiError } from '@/lib/api-error';
import { showError, showSuccess } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import {
  MAX_EXTRA_STOP_WORDS, MAX_STOP_WORD_LENGTH, SEARCH_QUERY_DEFAULTS, SEARCH_QUERY_FIELDS, SEARCH_SETTINGS_QUERY_KEY, outOfRange,
  searchQueryProblems, searchSettingsApi, stopWordsProblem, type SearchQuerySettings as QuerySettings,
} from '../../searchSettings';
import { FORM_SECTION, FormField, SectionHeader, TEXTAREA } from '../form/FormParts';
import { ResetFieldButton, SettingNumberField, withKey } from './SettingNumberField';

/** Words typed with commas, semicolons, spaces or new lines between them; each once. */
export function parseStopWords(text: string): string[] {
  const seen = new Set<string>();
  return text.split(/[\s,;]+/).map((word) => word.trim()).filter((word) => {
    const lower = word.toLocaleLowerCase();
    if (!word || seen.has(lower)) return false;
    seen.add(lower);
    return true;
  });
}

/** Admin > Semantic models: how a search over a model's records runs, for every model. */
export function SearchQuerySettings() {
  const { t } = useModuleTranslation('semantic-model');
  const queryClient = useQueryClient();
  const [configured, setConfigured] = useState<Partial<QuerySettings>>({});
  const [defaults, setDefaults] = useState<QuerySettings>(SEARCH_QUERY_DEFAULTS);
  const [wordsDraft, setWordsDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const adopt = (next: Partial<QuerySettings>) => { setConfigured(next); setWordsDraft(next.extraStopWords?.join(', ') ?? ''); };

  useEffect(() => {
    searchSettingsApi.getAdminSearch()
      .then((response) => { adopt(response.configured ?? {}); if (response.defaults) setDefaults({ ...SEARCH_QUERY_DEFAULTS, ...response.defaults }); })
      .catch((error) => showError(t('settings.loadError'), { description: parseApiError(error).message }));
  }, [t]);

  const problem = searchQueryProblems(configured, defaults);
  const save = async () => {
    setSaving(true);
    try {
      adopt((await searchSettingsApi.updateAdminSearch(configured)).configured ?? {});
      void queryClient.invalidateQueries({ queryKey: SEARCH_SETTINGS_QUERY_KEY });
      showSuccess(t('settings.saved'));
    } catch (error) {
      showError(t('settings.saveError'), { description: parseApiError(error).message });
    } finally {
      setSaving(false);
    }
  };

  const stopWordsLabel = t('searchSettings.search.stopWords');
  const extraLabel = t('searchSettings.search.extraStopWords');
  const wordsWrong = stopWordsProblem(configured.extraStopWords);
  return <section className={cn(FORM_SECTION, 'space-y-4')}>
    <SectionHeader title={t('searchSettings.search.title')} help={t('searchSettings.search.description')} icon={<Search className='h-4 w-4 text-muted-foreground' aria-hidden />} />
    <div className='grid gap-x-6 gap-y-4 sm:grid-cols-2'>
      {SEARCH_QUERY_FIELDS.map(({ key, min, max, step }) => <SettingNumberField key={key} id={`search-query-${key}`}
        label={t(`searchSettings.search.${key}`)} help={t(`searchSettings.search.${key}Tip`)}
        value={configured[key]} placeholder={defaults[key]} min={min} max={max} step={step}
        invalid={outOfRange(configured[key], { min, max }, step !== undefined)}
        onChange={(value) => setConfigured(withKey(configured, key, value))} />)}
      <FormField label={stopWordsLabel} help={t('searchSettings.search.stopWordsTip')} htmlFor='search-query-stopWords' className='sm:col-span-2'>
        <div className='flex h-9 items-center gap-2'>
          <Switch id='search-query-stopWords' checked={configured.stopWords ?? defaults.stopWords} aria-label={stopWordsLabel}
            onCheckedChange={(checked) => setConfigured(withKey(configured, 'stopWords', checked))} />
          {configured.stopWords !== undefined && <ResetFieldButton label={stopWordsLabel} onClick={() => setConfigured(withKey(configured, 'stopWords', undefined))} />}
        </div>
        <p className='text-[11px] text-muted-foreground'>{t('settings.builtIn', { value: t(defaults.stopWords ? 'searchSettings.yes' : 'searchSettings.no') })}</p>
      </FormField>
      <FormField label={extraLabel} help={t('searchSettings.search.extraStopWordsTip')} htmlFor='search-query-extraStopWords' className='sm:col-span-2'>
        <div className='flex items-start gap-1'>
          <Textarea id='search-query-extraStopWords' className={TEXTAREA} rows={2} value={wordsDraft} aria-invalid={wordsWrong}
            placeholder={t('searchSettings.search.extraStopWordsPlaceholder')}
            onChange={(event) => {
              setWordsDraft(event.target.value);
              const words = parseStopWords(event.target.value);
              setConfigured(withKey(configured, 'extraStopWords', words.length ? words : undefined));
            }} />
          {configured.extraStopWords !== undefined && <ResetFieldButton label={extraLabel} onClick={() => adopt(withKey(configured, 'extraStopWords', undefined))} />}
        </div>
        <p className={cn('text-[11px]', wordsWrong ? 'text-destructive' : 'text-muted-foreground')}>
          {wordsWrong
            ? t('searchSettings.problems.stopWords', { max: MAX_EXTRA_STOP_WORDS, length: MAX_STOP_WORD_LENGTH })
            : t('searchSettings.search.extraStopWordsCount', { count: configured.extraStopWords?.length ?? 0 })}
        </p>
      </FormField>
    </div>
    {problem && <p role='alert' className='text-xs text-destructive'>{t(problem, { max: MAX_EXTRA_STOP_WORDS, length: MAX_STOP_WORD_LENGTH })}</p>}
    <p className='text-xs text-muted-foreground'>{t('searchSettings.search.note')}</p>
    <div className='flex flex-wrap items-center gap-2'>
      <Button className='bg-foreground text-background hover:bg-foreground/90' onClick={() => void save()} disabled={saving || Boolean(problem)}>
        {saving ? t('settings.saving') : t('settings.save')}
      </Button>
      {Object.keys(configured).length > 0 && <Button variant='ghost' onClick={() => adopt({})}>{t('settings.reset')}</Button>}
    </div>
  </section>;
}
