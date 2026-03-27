import { useState } from 'react';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useModuleTranslation } from '@/modules/localization';
import type { RagType, WorkspaceSetting } from '../../../types';

type RagOption = {
  value: RagType;
  label: string;
  description: string;
};

type TemplatePreviewProps = {
  template: WorkspaceSetting;
  ragTypeOptions: RagOption[];
};

export function TemplatePreview({ template, ragTypeOptions }: TemplatePreviewProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { t } = useModuleTranslation('workspace');

  const getRagTypeLabel = (type: RagType) => {
    return ragTypeOptions.find((opt) => opt.value === type)?.label || type;
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button variant='ghost' size='sm' className='w-full justify-between text-muted-foreground hover:text-foreground'>
          <span className='flex items-center gap-2'>
            <Info className='h-4 w-4' />
            {t('modal.createWorkspace.step2.preview.button')}
          </span>
          {isOpen ? <ChevronUp className='h-4 w-4' /> : <ChevronDown className='h-4 w-4' />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className='mt-2 space-y-2 rounded-lg border bg-muted/30 p-3 text-sm'>
        {template.instruction && (
          <div>
            <span className='font-medium'>{t('modal.createWorkspace.step2.preview.instruction')}</span>
            <p className='text-muted-foreground mt-1 whitespace-pre-wrap line-clamp-3'>{template.instruction}</p>
          </div>
        )}
        <div className='grid grid-cols-2 gap-2'>
          <div>
            <span className='font-medium'>{t('modal.createWorkspace.step2.preview.chunks')}</span>{' '}
            <span className='text-muted-foreground'>{template.chunks}</span>
          </div>
          <div>
            <span className='font-medium'>{t('modal.createWorkspace.step2.preview.topK')}</span>{' '}
            <span className='text-muted-foreground'>{template.topK}</span>
          </div>
          <div>
            <span className='font-medium'>{t('modal.createWorkspace.step2.preview.ragType')}</span>{' '}
            <span className='text-muted-foreground'>{getRagTypeLabel(template.ragType)}</span>
          </div>
          <div>
            <span className='font-medium'>{t('modal.createWorkspace.step2.preview.maxTokens')}</span>{' '}
            <span className='text-muted-foreground'>{template.maxToken}</span>
          </div>
          <div>
            <span className='font-medium'>{t('modal.createWorkspace.step2.preview.hybridSearch')}</span>{' '}
            <span className='text-muted-foreground'>
              {template.hybridSearch ? t('modal.createWorkspace.step2.preview.hybridYes') : t('modal.createWorkspace.step2.preview.hybridNo')}
            </span>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
