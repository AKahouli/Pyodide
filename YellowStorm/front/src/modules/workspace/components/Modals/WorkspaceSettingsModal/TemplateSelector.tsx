import { Loader2, Star } from 'lucide-react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';

import { useModuleTranslation } from '@/modules/localization';
import type { WorkspaceSetting } from '../../../types';

type TemplateSelectorProps = Readonly<{
  templates: WorkspaceSetting[];
  isLoading: boolean;
  disabled: boolean;
  onApply: (templateId: string) => void;
}>;

export function TemplateSelector({ templates, isLoading, disabled, onApply }: TemplateSelectorProps) {
  const { t } = useModuleTranslation('workspace');

  if (templates.length === 0) {
    return null;
  }

  return (
    <>
      <div className='space-y-2'>
        <p className='text-sm font-medium'>{t('settings.template.title')}</p>
        <p className='text-xs text-muted-foreground'>{t('settings.template.description')}</p>
        <Select onValueChange={onApply} disabled={disabled}>
          <SelectTrigger className='h-10 sm:h-9'>
            <SelectValue placeholder={t('settings.template.placeholder')} />
          </SelectTrigger>
          <SelectContent className='max-h-[40vh]'>
            {isLoading ? (
              <div className='flex items-center justify-center py-4'>
                <Loader2 className='h-4 w-4 animate-spin' />
              </div>
            ) : (
              templates.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  <div className='flex items-start gap-2'>
                    {template.isPredefined && <Star className='h-3 w-3 text-yellow-500 fill-yellow-500 mt-0.5 shrink-0' />}
                    <div className='flex flex-col min-w-0'>
                      <span className='truncate'>{template.name}</span>
                      {template.description && <span className='text-xs text-muted-foreground truncate'>{template.description}</span>}
                    </div>
                  </div>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>
      <Separator />
    </>
  );
}
