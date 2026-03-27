import { Plus, Play, Save, Check, Loader2, History, Wand2, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useModuleTranslation } from '@/modules/localization';

interface Props {
  onAddStep: () => void;
  onAutoLayout: () => void;
  onRun: () => void;
  onSave: () => void;
  onViewExecutions: () => void;
  onToggleDesigner: () => void;
  designerOpen: boolean;
  isDirty: boolean;
  isSaving: boolean;
  isExecuting: boolean;
  canRun: boolean;
  executionMode: 'live' | 'inherit';
  onExecutionModeChange: (mode: 'live' | 'inherit') => void;
}

export function PlaybookToolbar({
  onAddStep,
  onAutoLayout,
  onRun,
  onSave,
  onViewExecutions,
  onToggleDesigner,
  designerOpen,
  isDirty,
  isSaving,
  isExecuting,
  canRun,
  executionMode,
  onExecutionModeChange,
}: Props) {
  const { t } = useModuleTranslation('playbook');

  return (
    <div className="flex items-center gap-1 sm:gap-2">
      <Select value={executionMode} onValueChange={(value) => onExecutionModeChange(value as 'live' | 'inherit')}>
        <SelectTrigger className="h-9 w-[140px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
        <SelectItem value="live">Live Mode</SelectItem>
        <SelectItem value="inherit">Inherit Step Modes</SelectItem>
      </SelectContent>
      </Select>
      <Button variant={designerOpen ? "default" : "outline"} size="sm" onClick={onToggleDesigner} className="px-2 sm:px-3">
        <Wand2 className="h-4 w-4 sm:mr-1" />
        <span className="hidden sm:inline">{t('toolbar.designer')}</span>
      </Button>
      <Button variant="outline" size="sm" onClick={onAddStep} className="px-2 sm:px-3">
        <Plus className="h-4 w-4 sm:mr-1" />
        <span className="hidden sm:inline">{t('toolbar.addStep')}</span>
      </Button>
      <Button variant="outline" size="sm" onClick={onAutoLayout} className="px-2 sm:px-3">
        <LayoutGrid className="h-4 w-4 sm:mr-1" />
        <span className="hidden sm:inline">{t('toolbar.autoLayout')}</span>
      </Button>
      <Button variant="outline" size="sm" onClick={onViewExecutions} className="px-2 sm:px-3">
        <History className="h-4 w-4 sm:mr-1" />
        <span className="hidden sm:inline">{t('toolbar.executions')}</span>
      </Button>
      <Button variant="outline" size="sm" onClick={onSave} disabled={!isDirty || isSaving} className="px-2 sm:px-3">
        {isSaving ? (
          <Loader2 className="h-4 w-4 sm:mr-1 animate-spin" />
        ) : isDirty ? (
          <Save className="h-4 w-4 sm:mr-1" />
        ) : (
          <Check className="h-4 w-4 sm:mr-1" />
        )}
        <span className="hidden sm:inline">
          {isSaving ? t('toolbar.saving') : isDirty ? t('toolbar.save') : t('toolbar.saved')}
        </span>
      </Button>
      <Button size="sm" onClick={onRun} disabled={!canRun || isExecuting} className="px-2 sm:px-3">
        {isExecuting ? (
          <Loader2 className="h-4 w-4 sm:mr-1 animate-spin" />
        ) : (
          <Play className="h-4 w-4 sm:mr-1" />
        )}
        <span className="hidden sm:inline">{isExecuting ? t('toolbar.starting') : t('toolbar.run')}</span>
      </Button>
    </div>
  );
}
