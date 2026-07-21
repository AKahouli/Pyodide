import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useModuleTranslation } from '@/modules/localization';

export function PageRangeField({ value, onChange, currentPage, disabled }: { value: string; onChange: (value: string) => void; currentPage?: number; disabled?: boolean }) {
  const { t } = useModuleTranslation('file-viewer');
  return <div className='space-y-2'><Label htmlFor='decision-flow-pages'>{t('transformation.pages')}</Label><div className='flex gap-2'><Input id='decision-flow-pages' value={value} onChange={(event) => onChange(event.target.value)} placeholder={t('transformation.pagesPlaceholder')} disabled={disabled} /><Button type='button' variant='outline' onClick={() => currentPage && onChange(String(currentPage))} disabled={disabled || !currentPage}>{t('transformation.useCurrentPage')}</Button></div></div>;
}
