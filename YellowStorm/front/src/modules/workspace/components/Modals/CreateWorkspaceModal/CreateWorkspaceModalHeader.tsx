import { DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useModuleTranslation } from '@/modules/localization';
import { StepIndicator } from '../../StepIndicator';

type CreateWorkspaceModalHeaderProps = {
  currentStep: number;
};

export function CreateWorkspaceModalHeader({ currentStep }: CreateWorkspaceModalHeaderProps) {
  const { t } = useModuleTranslation('workspace');

  return (
    <DialogHeader>
      <DialogTitle>{t('modal.createWorkspace.title')}</DialogTitle>
      <StepIndicator currentStep={currentStep} totalSteps={2} />
    </DialogHeader>
  );
}
