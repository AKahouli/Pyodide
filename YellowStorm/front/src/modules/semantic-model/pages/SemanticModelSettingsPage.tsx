import { useEffect, useState } from 'react';
import { Loader2, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseApiError } from '@/lib/api-error';
import { showError, showSuccess } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../api';
import { AiLimitFields, limitProblem } from '../components/mapping/DocumentFieldRules';
import type { AiExtractionSettings } from '../types';
import { RunLimitsSettings } from '../components/settings/RunLimitsSettings';
import { FORM_SECTION, SectionHeader } from '../components/form/FormParts';

/** The limits every document mapping starts from when nothing else is set. */
const BUILT_IN: AiExtractionSettings = { maxBlocks: 400, maxCharacters: 60000, longDocumentCharacters: 30000, blocksPerField: 8 };

/**
 * Admin > Semantic models: how much of each document the AI reads, for every model. A document
 * mapping can change any of these limits for its own files.
 */
export function SemanticModelSettingsPage() {
  const { t } = useModuleTranslation('semantic-model');
  const [configured, setConfigured] = useState<Partial<AiExtractionSettings>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    semanticModelApi.getAdminExtractionSettings()
      .then((settings) => setConfigured(settings.configured))
      .catch((error) => showError(t('settings.loadError'), { description: parseApiError(error).message }))
      .finally(() => setLoading(false));
  }, [t]);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await semanticModelApi.updateAdminExtractionSettings(configured);
      setConfigured(saved.configured);
      showSuccess(t('settings.saved'));
    } catch (error) {
      showError(t('settings.saveError'), { description: parseApiError(error).message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className='flex justify-center py-12'><Loader2 className='h-6 w-6 animate-spin' /></div>;

  return <div className='mx-auto max-w-4xl space-y-6'>
    <div>
      <h1 className='text-2xl font-semibold'>{t('settings.title')}</h1>
      <p className='text-sm text-muted-foreground'>{t('settings.description')}</p>
    </div>
    <section className={cn(FORM_SECTION, 'space-y-4')}>
      <SectionHeader title={t('settings.aiTitle')} help={t('settings.aiDescription')} icon={<SlidersHorizontal className='h-4 w-4 text-muted-foreground' aria-hidden />} />
      <AiLimitFields idPrefix='admin-ai' value={configured} placeholder={BUILT_IN} onChange={setConfigured} />
      <div className='flex flex-wrap items-center gap-2'>
        <Button className='bg-foreground text-background hover:bg-foreground/90' onClick={() => void save()} disabled={saving || Boolean(limitProblem(configured))}>
          {saving ? t('settings.saving') : t('settings.save')}
        </Button>
        {Object.keys(configured).length > 0 && <Button variant='ghost' onClick={() => setConfigured({})}>{t('settings.reset')}</Button>}
      </div>
    </section>
    <RunLimitsSettings />
  </div>;
}
