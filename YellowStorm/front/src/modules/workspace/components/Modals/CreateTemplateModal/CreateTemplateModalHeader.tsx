import { DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useModuleTranslation } from '@/modules/localization';
import { StepIndicator } from '../../StepIndicator';

type CreateTemplateModalHeaderProps = {
  currentStep: number;
};

export function CreateTemplateModalHeader({ currentStep }: CreateTemplateModalHeaderProps) {
  const { t } = useModuleTranslation('workspace');

  return (
    <DialogHeader>
      <DialogTitle>{t('modal.createTemplate.title')}</DialogTitle>
      <StepIndicator currentStep={currentStep} totalSteps={2} />
    </DialogHeader>
  );
}
