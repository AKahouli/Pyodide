import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';

import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

import { useWorkspaceStore, useWorkspaceModalState, useWorkspaceLoading, useCurrentWorkspaceSettings, useSettingsTargetWorkspace } from '../../../store';

import { settingsSchema, type SettingsFormValues } from './schema';
import { SettingsHeader } from './SettingsHeader';
import { CurrentSettingsCard } from './CurrentSettingsCard';
import { TemplateSelector } from './TemplateSelector';
import { SettingsFormSection } from './SettingsFormSection';

export function WorkspaceSettingsModal() {
  const { isSettingsModalOpen } = useWorkspaceModalState();
  const { isLoadingSettings, isSavingSettings, isLoadingTemplates } = useWorkspaceLoading();
  const currentSettings = useCurrentWorkspaceSettings();
  const targetWorkspace = useSettingsTargetWorkspace();

  const closeSettingsModal = useWorkspaceStore((state) => state.closeSettingsModal);
  const updateCurrentWorkspaceSettings = useWorkspaceStore((state) => state.updateCurrentWorkspaceSettings);
  const assignSettingsToWorkspace = useWorkspaceStore((state) => state.assignSettingsToWorkspace);
  const clearWorkspaceSettings = useWorkspaceStore((state) => state.clearWorkspaceSettings);
  const createSetting = useWorkspaceStore((state) => state.createSetting);
  const templates = useWorkspaceStore((state) => state.templates);
  const fetchTemplates = useWorkspaceStore((state) => state.fetchTemplates);

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      instruction: '',
      chunks: 5,
      hybridSearch: false,
      ragType: 'standard',
      maxToken: 32000,
      topK: 10,
    },
  });

  useEffect(() => {
    if (isSettingsModalOpen) {
      fetchTemplates();
    }
  }, [isSettingsModalOpen, fetchTemplates]);

  useEffect(() => {
    if (currentSettings) {
      form.reset({
        instruction: currentSettings.instruction || '',
        chunks: currentSettings.chunks,
        hybridSearch: currentSettings.hybridSearch,
        ragType: currentSettings.ragType,
        maxToken: currentSettings.maxToken,
        topK: currentSettings.topK,
      });
    } else {
      form.reset({
        instruction: '',
        chunks: 5,
        hybridSearch: false,
        ragType: 'standard',
        maxToken: 32000,
        topK: 10,
      });
    }
  }, [currentSettings, form]);

  const handleSave = async (data: SettingsFormValues) => {
    if (currentSettings) {
      await updateCurrentWorkspaceSettings(data);
    } else if (targetWorkspace) {
      try {
        const newSettings = await createSetting({
          name: `${targetWorkspace.name} Settings`,
          description: `Custom settings for ${targetWorkspace.name}`,
          ...data,
        });
        await assignSettingsToWorkspace(newSettings.id);
      } catch {
        // Errors handled by store
      }
    }
  };

  const handleApplyTemplate = async (templateId: string) => {
    await assignSettingsToWorkspace(templateId);
  };

  const handleClearSettings = async () => {
    await clearWorkspaceSettings();
  };

  const hasChanges = form.formState.isDirty;

  return (
    <Dialog open={isSettingsModalOpen} onOpenChange={(open) => !open && closeSettingsModal()}>
      <DialogContent className='w-[95vw] max-w-xl p-0 gap-0 max-h-[90vh] flex flex-col'>
        <SettingsHeader workspaceName={targetWorkspace?.name} />

        {isLoadingSettings ? (
          <div className='flex items-center justify-center py-12 flex-1'>
            <Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
          </div>
        ) : (
          <ScrollArea className='flex-1 overflow-y-auto'>
            <div className='px-4 py-4 sm:px-6 sm:py-5 space-y-4 sm:space-y-6'>
              <CurrentSettingsCard currentSettings={currentSettings} onClear={handleClearSettings} />

              <TemplateSelector templates={templates} isLoading={isLoadingTemplates} disabled={isSavingSettings} onApply={handleApplyTemplate} />

              <SettingsFormSection form={form} currentSettings={currentSettings} isSaving={isSavingSettings} hasChanges={hasChanges} onCancel={closeSettingsModal} onSubmit={handleSave} />
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
