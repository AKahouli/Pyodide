/**
 * Create Workspace Modal
 * 2-step wizard for creating a new workspace
 * Note: Template creation has its own modal (CreateTemplateModal)
 */

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useWorkspaceStore, useWorkspaceModalState } from '../../../store';
import { CreateWorkspaceStep1, type Step1FormValues } from './CreateWorkspaceStep1';
import { CreateWorkspaceStep2, type Step2FormValues } from './CreateWorkspaceStep2';
import { CreateWorkspaceModalHeader } from './CreateWorkspaceModalHeader';

export function CreateWorkspaceModal() {
  const navigate = useNavigate();
  const { isCreateModalOpen, createModalStep } = useWorkspaceModalState();
  const closeCreateModal = useWorkspaceStore((state) => state.closeCreateModal);
  const setCreateModalStep = useWorkspaceStore((state) => state.setCreateModalStep);
  const createWorkspace = useWorkspaceStore((state) => state.createWorkspace);
  const createSetting = useWorkspaceStore((state) => state.createSetting);

  const [step1Data, setStep1Data] = useState<Step1FormValues | null>(null);

  const handleStep1Next = (data: Step1FormValues) => {
    setStep1Data(data);
    setCreateModalStep(2);
  };

  const handleStep2Back = () => {
    setCreateModalStep(1);
  };

  const handleStep2Submit = async (step2Data: Step2FormValues) => {
    if (!step1Data) return;

    try {
      let settingId: string | undefined;

      switch (step2Data.mode) {
        case 'default':
          settingId = undefined;
          break;
        case 'template':
          settingId = step2Data.templateId;
          break;
        case 'custom':
          if (step2Data.customSettings) {
            const setting = await createSetting({
              name: `${step1Data.name} Settings`,
              description: `Custom settings for ${step1Data.name}`,
              instruction: step2Data.customSettings.instruction,
              chunks: step2Data.customSettings.chunks,
              hybridSearch: step2Data.customSettings.hybridSearch,
              ragType: step2Data.customSettings.ragType,
              maxToken: step2Data.customSettings.maxToken,
              topK: step2Data.customSettings.topK,
            });
            settingId = setting.id;
          }
          break;
      }

      const workspace = await createWorkspace({
        name: step1Data.name,
        description: step1Data.description,
        settings: settingId,
      });

      setStep1Data(null);
      closeCreateModal();
      navigate(`/workspace/${workspace.id}`);
    } catch (error) {
      console.error('Failed to create workspace:', error);
    }
  };

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setStep1Data(null);
        closeCreateModal();
      }
    },
    [closeCreateModal],
  );

  return (
    <Dialog open={isCreateModalOpen} onOpenChange={handleOpenChange}>
      <DialogContent className='w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto'>
        <CreateWorkspaceModalHeader currentStep={createModalStep} />

        {createModalStep === 1 ? <CreateWorkspaceStep1 defaultValues={step1Data || undefined} onNext={handleStep1Next} /> : <CreateWorkspaceStep2 onBack={handleStep2Back} onSubmit={handleStep2Submit} />}
      </DialogContent>
    </Dialog>
  );
}
