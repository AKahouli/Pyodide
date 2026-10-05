import { useEffect, useState } from 'react';
import { Layers } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { parseApiError } from '@/lib/api-error';
import { showError, showSuccess } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import {
  SEARCH_INDEX_DEFAULTS, SEARCH_INDEX_FIELDS, SEARCH_SETTINGS_QUERY_KEY, effectiveIndex, indexRange, outOfRange, searchIndexProblems,
  searchSettingsApi, type SearchIndexSettings as IndexSettings,
} from '../../searchSettings';
import { FORM_SECTION, FormField, SectionHeader } from '../form/FormParts';
import { ResetFieldButton, SettingNumberField, withKey } from './SettingNumberField';

/** Admin > Semantic models: how records are cut into a search card and passages, for every model. */
export function SearchIndexSettings() {
  const { t } = useModuleTranslation('semantic-model');
  const queryClient = useQueryClient();
  const [configured, setConfigured] = useState<Partial<IndexSettings>>({});
  const [defaults, setDefaults] = useState<IndexSettings>(SEARCH_INDEX_DEFAULTS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    searchSettingsApi.getAdminIndex()
      .then((response) => { setConfigured(response.configured ?? {}); if (response.defaults) setDefaults({ ...SEARCH_INDEX_DEFAULTS, ...response.defaults }); })
      .catch((error) => showError(t('settings.loadError'), { description: parseApiError(error).message }));
  }, [t]);

  const effective = effectiveIndex(configured, defaults);
  const problem = searchIndexProblems(configured, defaults);
  const save = async () => {
    setSaving(true);
    try {
      setConfigured((await searchSettingsApi.updateAdminIndex(configured)).configured ?? {});
      void queryClient.invalidateQueries({ queryKey: SEARCH_SETTINGS_QUERY_KEY });
      showSuccess(t('settings.saved'));
    } catch (error) {
      showError(t('settings.saveError'), { description: parseApiError(error).message });
    } finally {
      setSaving(false);
    }
  };

  const headerLabel = t('searchSettings.index.passageHeader');
  return <section className={cn(FORM_SECTION, 'space-y-4')}>
    <SectionHeader title={t('searchSettings.index.title')} help={t('searchSettings.index.description')} icon={<Layers className='h-4 w-4 text-muted-foreground' aria-hidden />} />
    <div className='grid gap-x-6 gap-y-4 sm:grid-cols-2'>
      {SEARCH_INDEX_FIELDS.map(({ key }) => {
        const range = indexRange(key, effective);
        const placeholder = key === 'longFieldChars' ? effective.cardValueChars : defaults[key];
        return <SettingNumberField key={key} id={`search-index-${key}`} label={t(`searchSettings.index.${key}`)} help={t(`searchSettings.index.${key}Tip`)}
          value={configured[key]} placeholder={placeholder} min={range.min} max={range.max} invalid={outOfRange(configured[key], range)}
          footer={key === 'longFieldChars' ? t('searchSettings.index.longFieldDefault', { value: placeholder.toLocaleString() }) : undefined}
          onChange={(value) => setConfigured(withKey(configured, key, value))} />;
      })}
      <FormField label={headerLabel} help={t('searchSettings.index.passageHeaderTip')} htmlFor='search-index-passageHeader' className='sm:col-span-2'>
        <div className='flex h-9 items-center gap-2'>
          <Switch id='search-index-passageHeader' checked={effective.passageHeader} aria-label={headerLabel}
            onCheckedChange={(checked) => setConfigured(withKey(configured, 'passageHeader', checked))} />
          {configured.passageHeader !== undefined && <ResetFieldButton label={headerLabel} onClick={() => setConfigured(withKey(configured, 'passageHeader', undefined))} />}
        </div>
        <p className='text-[11px] text-muted-foreground'>{t('settings.builtIn', { value: t(defaults.passageHeader ? 'searchSettings.yes' : 'searchSettings.no') })}</p>
      </FormField>
    </div>
    {problem && <p role='alert' className='text-xs text-destructive'>{t(problem)}</p>}
    <p className='text-xs text-muted-foreground'>{t('searchSettings.index.note')}</p>
    <div className='flex flex-wrap items-center gap-2'>
      <Button className='bg-foreground text-background hover:bg-foreground/90' onClick={() => void save()} disabled={saving || Boolean(problem)}>
        {saving ? t('settings.saving') : t('settings.save')}
      </Button>
      {Object.keys(configured).length > 0 && <Button variant='ghost' onClick={() => setConfigured({})}>{t('settings.reset')}</Button>}
    </div>
  </section>;
}
