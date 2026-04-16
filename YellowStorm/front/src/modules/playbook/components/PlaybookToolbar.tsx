import { Play, Save, Check, Loader2, History, Wand2, CalendarClock, Download, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useModuleTranslation } from '@/modules/localization';
import type { PlaybookPageMode } from '../types';

interface Props {
  pageMode: PlaybookPageMode;
  onPageModeChange: (mode: PlaybookPageMode) => void;
  hasExecutionContext?: boolean;
  hasPendingInterrupt?: boolean;
  onRun: () => void;
  onSave: () => void;
  onViewExecutions: () => void;
  onToggleCopilot?: () => void;
  copilotOpen?: boolean;
  isDirty: boolean;
  isSaving: boolean;
  isExecuting: boolean;
  canRun: boolean;
  nodeReflectionEnabled: boolean;
  onNodeReflectionChange: (enabled: boolean) => void;
  advisorAutopilotEnabled?: boolean;
  onAdvisorAutopilotChange?: (enabled: boolean) => void;
  onDownloadAllResults?: () => void;
  canDownloadAllResults?: boolean;
  /** Opens schedule dialog (design mode). */
  onSchedule?: () => void;
}

export function PlaybookToolbar({
  pageMode,
  onPageModeChange,
  hasExecutionContext = false,
  hasPendingInterrupt = false,
  onRun,
  onSave,
  onViewExecutions,
  onToggleCopilot = () => {},
  copilotOpen = false,
  isDirty,
  isSaving,
  isExecuting,
  canRun,
  nodeReflectionEnabled,
  onNodeReflectionChange,
  advisorAutopilotEnabled = false,
  onAdvisorAutopilotChange,
  onDownloadAllResults,
  canDownloadAllResults = false,
  onSchedule,
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
      {onDownloadAllResults && (
        <Button variant="outline" size="sm" onClick={onDownloadAllResults} disabled={!canDownloadAllResults} className="px-2 sm:px-3">
          <Download className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">{t('execution.downloadAllResults')}</span>
        </Button>
      )}
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
      {onSchedule && (
         <Button variant="outline" size="sm" onClick={onSchedule} className="px-2 sm:px-3">
             <CalendarClock className="h-4 w-4 sm:mr-1" />
             <span className="hidden sm:inline">{t('toolbar.schedule')}</span>
         </Button>
      )}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="px-2 sm:px-3" aria-label={t('toolbar.runSettings')} title={t('toolbar.runSettings')}>
            <Settings2 className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">{t('toolbar.runSettings')}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 space-y-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">{t('toolbar.runSettings')}</div>
            <div className="text-xs text-muted-foreground">{t('toolbar.runSettingsHint')}</div>
          </div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
            <span>{t('toolbar.advisor')}</span>
            <Switch checked={nodeReflectionEnabled} onCheckedChange={onNodeReflectionChange} />
          </div>
          {onAdvisorAutopilotChange && (
            <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span>{t('toolbar.stepAutopilot')}</span>
              <Switch checked={advisorAutopilotEnabled} onCheckedChange={onAdvisorAutopilotChange} />
            </div>
          )}
        </PopoverContent>
      </Popover>
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
