import { History, Loader2, RotateCcw, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { useSemanticVersions } from '../../query/hooks';

export function VersionsPanel({ modelId, canEdit, canPublish, onPublished }: Readonly<{ modelId: string; canEdit: boolean; canPublish: boolean; onPublished: () => void }>) {
  const { t,language } = useModuleTranslation('semantic-model');
  const versions = useSemanticVersions(modelId);
  const publish = async () => {
    try { await semanticModelApi.publish(modelId); await versions.refetch(); onPublished(); showSuccess(t('versions.published')); }
    catch (error) { showError(t('versions.publishError'),{description:error instanceof Error ? error.message : undefined}); }
  };
  return <aside className='w-80 shrink-0 overflow-y-auto border-r bg-background/90 p-4'><div className='mb-5 flex items-start gap-3'><div className='rounded-xl bg-primary/10 p-2 text-primary'><History className='h-5 w-5' /></div><div><h2 className='font-semibold'>{t('versions.title')}</h2><p className='text-xs text-muted-foreground'>{t('versions.description')}</p></div></div>{canEdit&&<Button className='mb-5 w-full' onClick={() => void publish()} disabled={!canPublish}><Send className='mr-2 h-4 w-4' />{t('versions.publish')}</Button>}{versions.isLoading ? <Loader2 className='mx-auto h-5 w-5 animate-spin' /> : <div className='space-y-3'>{(versions.data ?? []).map((version) => <div key={version.id} className='rounded-xl border p-3'><div className='flex items-center justify-between'><p className='text-sm font-semibold'>{t('versions.number',{number:version.versionNumber})}</p><Badge variant={version.status === 'published' ? 'default':'secondary'}>{t(`status.${version.status}`)}</Badge></div><p className='mt-2 text-xs text-muted-foreground'>{new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'short'}).format(new Date(version.createdAt))}</p>{canEdit&&version.status === 'published' && <Button className='mt-3 w-full' size='sm' variant='outline' onClick={() => void semanticModelApi.restore(modelId,version.id).then(async () => { await versions.refetch(); onPublished(); showSuccess(t('versions.restored')); })}><RotateCcw className='mr-2 h-3.5 w-3.5' />{t('versions.restore')}</Button>}</div>)}</div>}</aside>;
}
