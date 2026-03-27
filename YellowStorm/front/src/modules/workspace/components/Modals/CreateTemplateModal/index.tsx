/**
 * Create Template Modal
 * 2-step wizard for creating a workspace settings template
 * Separate from CreateWorkspaceModal to avoid confusion
 */

import { useState, useCallback } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useWorkspaceStore, useWorkspaceModalState } from '../../../store';
import { CreateTemplateStep1, type TemplateStep1FormValues } from './CreateTemplateStep1';
import { CreateTemplateStep2, type TemplateStep2FormValues } from './CreateTemplateStep2';
import { CreateTemplateModalHeader } from './CreateTemplateModalHeader';

export function CreateTemplateModal() {
  const { isCreateTemplateModalOpen, createTemplateModalStep } = useWorkspaceModalState();
  const closeCreateTemplateModal = useWorkspaceStore((state) => state.closeCreateTemplateModal);
  const setCreateTemplateModalStep = useWorkspaceStore((state) => state.setCreateTemplateModalStep);
  const createSetting = useWorkspaceStore((state) => state.createSetting);

  // Store step 1 data
  const [step1Data, setStep1Data] = useState<TemplateStep1FormValues | null>(null);

  const handleStep1Next = (data: TemplateStep1FormValues) => {
    setStep1Data(data);
    setCreateTemplateModalStep(2);
  };

  const handleStep2Back = () => {
    setCreateTemplateModalStep(1);
  };

  const handleStep2Submit = async (step2Data: TemplateStep2FormValues) => {
    if (!step1Data) return;

    try {
      // Create a workspace setting template
      await createSetting({
        name: step1Data.name,
        description: step1Data.description,
        tag: step1Data.tag,
        isTemplate: true,
        instruction: step2Data.instruction,
        chunks: step2Data.chunks,
        hybridSearch: step2Data.hybridSearch,
        ragType: step2Data.ragType,
        maxToken: step2Data.maxToken,
        topK: step2Data.topK,
      });

      // Reset state and close modal
      setStep1Data(null);
      closeCreateTemplateModal();
    } catch (error) {
      console.error('Failed to create template:', error);
      // Error is handled in the store with toast
    }
  };

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setStep1Data(null);
        closeCreateTemplateModal();
      }
    },
    [closeCreateTemplateModal],
  );

  return (
    <Dialog open={isCreateTemplateModalOpen} onOpenChange={handleOpenChange}>
      <DialogContent className='w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto'>
        <CreateTemplateModalHeader currentStep={createTemplateModalStep} />

        {createTemplateModalStep === 1 ? <CreateTemplateStep1 defaultValues={step1Data || undefined} onNext={handleStep1Next} /> : <CreateTemplateStep2 onBack={handleStep2Back} onSubmit={handleStep2Submit} />}
      </DialogContent>
    </Dialog>
  );
}
