import { Plus, Play, Save, Check, Loader2, History, Wand2, LayoutGrid, Undo2, Redo2, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useModuleTranslation } from '@/modules/localization';
import { TASK_TEMPLATES } from '../utils/task-template-registry';
import { PORT_COLORS } from '../utils/port-colors';
import type { TaskTemplate, PlaybookPageMode } from '../types';

interface Props {
  pageMode: PlaybookPageMode;
  onPageModeChange: (mode: PlaybookPageMode) => void;
  hasExecutionContext?: boolean;
  hasPendingInterrupt?: boolean;
  onAddStep: () => void;
  onAddStepFromTemplate: (template: TaskTemplate) => void;
  onAutoLayout: () => void;
  onRun: () => void;
  onSave: () => void;
  onViewExecutions: () => void;
  onToggleCopilot?: () => void;
  copilotOpen?: boolean;
  isDirty: boolean;
  isSaving: boolean;
  isExecuting: boolean;
  canRun: boolean;
  executionMode: 'live' | 'inherit';
  onExecutionModeChange: (mode: 'live' | 'inherit') => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export function PlaybookToolbar({
  pageMode,
  onPageModeChange,
  hasExecutionContext = false,
  hasPendingInterrupt = false,
  onAddStep,
  onAddStepFromTemplate,
  onAutoLayout,
  onRun,
  onSave,
  onViewExecutions,
  onToggleCopilot = () => {},
  copilotOpen = false,
  isDirty,
  isSaving,
  isExecuting,
  canRun,
  executionMode,
  onExecutionModeChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: Props) {
  const { t } = useModuleTranslation('playbook');
  const showCopilotAction = pageMode === 'design' || hasPendingInterrupt || copilotOpen;
  const showExecutionsAction = pageMode === 'run' || hasExecutionContext;

  return (
    <div className="flex items-center gap-1 sm:gap-2">
      <div className="flex items-center rounded-md border p-0.5">
        {(['design', 'run'] as const).map((mode) => (
          <Button
            key={mode}
            type="button"
            variant={pageMode === mode ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 px-2 sm:px-3"
            onClick={() => onPageModeChange(mode)}
          >
            {t(`mode.${mode}`)}
          </Button>
        ))}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onUndo}
        disabled={!canUndo || isSaving}
        className="h-8 px-2"
        title="Undo (Ctrl+Z)"
      >
        <Undo2 className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRedo}
        disabled={!canRedo || isSaving}
        className="h-8 px-2"
        title="Redo (Ctrl+Shift+Z)"
      >
        <Redo2 className="h-4 w-4" />
      </Button>
      <Select value={executionMode} onValueChange={(value) => onExecutionModeChange(value as 'live' | 'inherit')}>
        <SelectTrigger className="h-9 w-[140px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="live">{t('toolbar.executionMode.live')}</SelectItem>
          <SelectItem value="inherit">{t('toolbar.executionMode.inherit')}</SelectItem>
        </SelectContent>
      </Select>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <div className="flex">
            <Button variant="outline" size="sm" onClick={onAddStep} className="rounded-r-none border-r-0 px-2 sm:px-3">
              <Plus className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">{t('toolbar.addBlankStep')}</span>
            </Button>
            <Button variant="outline" size="sm" className="h-9 rounded-l-none px-1.5">
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem onClick={onAddStep}>
            <Plus className="h-4 w-4 mr-2" />
            {t('toolbar.addBlankStep')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {TASK_TEMPLATES.map((tpl) => {
            const KindIcon = PORT_COLORS[tpl.inputPorts[0]?.artifactKind || 'text'].icon;
            return (
              <DropdownMenuItem key={tpl.id} onClick={() => onAddStepFromTemplate(tpl)}>
                <KindIcon className="h-4 w-4 mr-2 text-muted-foreground" />
                {t(`taskType.${tpl.type}` as any)}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="outline" size="sm" onClick={onAutoLayout} className="px-2 sm:px-3">
        <LayoutGrid className="h-4 w-4 sm:mr-1" />
        <span className="hidden sm:inline">{t('toolbar.autoLayout')}</span>
      </Button>
      {showCopilotAction && (
        <Button
          variant={copilotOpen ? 'default' : 'outline'}
          size="sm"
          onClick={onToggleCopilot}
          className="px-2 sm:px-3"
        >
          <Wand2 className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">
            {pageMode === 'run' ? t('toolbar.copilot') : t('toolbar.designer')}
          </span>
        </Button>
      )}
      {showExecutionsAction && (
        <Button variant="outline" size="sm" onClick={onViewExecutions} className="px-2 sm:px-3">
          <History className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">{t('toolbar.executions')}</span>
        </Button>
      )}
      <Button
        variant={isDirty ? 'outline' : 'ghost'}
        size="sm"
        onClick={onSave}
        disabled={!isDirty || isSaving}
        className="px-2 sm:px-3"
      >
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
