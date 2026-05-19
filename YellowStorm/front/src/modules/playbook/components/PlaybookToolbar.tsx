import { useState } from 'react';
import { Play, Save, Check, Loader2, History, Settings2, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useModuleTranslation } from '@/modules/localization';
import type { PlaybookDesignSettings, PlaybookPageMode } from '../types';

interface Props {
  pageMode: PlaybookPageMode;
  onPageModeChange: (mode: PlaybookPageMode) => void;
  hasExecutionContext?: boolean;
  onRun: () => void;
  onStop?: () => void;
  onSave: () => void;
  onViewExecutions: () => void;
  isDirty: boolean;
  isSaving: boolean;
  isExecuting: boolean;
  hasActiveExecution?: boolean;
  isStopping?: boolean;
  canRun: boolean;
  nodeReflectionEnabled: boolean;
  onNodeReflectionChange: (enabled: boolean) => void;
  advisorAutopilotEnabled?: boolean;
  onAdvisorAutopilotChange?: (enabled: boolean) => void;
  advisorScoringMode?: import('../types').AdvisorScoringMode;
  onAdvisorScoringModeChange?: (mode: import('../types').AdvisorScoringMode) => void;
  /** Opens triggers dialog (design mode). */
  onTriggers?: () => void;
  triggersOpen?: boolean;
  designSettings?: PlaybookDesignSettings;
  onDesignSettingsChange?: (settings: Partial<PlaybookDesignSettings>) => void;
  /** Opens flow settings drawer (canvas header area). */
  onOpenFlowSettings?: () => void;
}

export function PlaybookToolbar({
  pageMode,
  onPageModeChange,
  hasExecutionContext = false,
  onRun,
  onStop,
  onSave,
  onViewExecutions,
  isDirty,
  isSaving,
  isExecuting,
  hasActiveExecution = false,
  isStopping = false,
  canRun,
  nodeReflectionEnabled,
  onNodeReflectionChange,
  advisorAutopilotEnabled = false,
  onAdvisorAutopilotChange,
  advisorScoringMode = 'llm',
  onAdvisorScoringModeChange,
  onTriggers,
  triggersOpen = false,
  designSettings,
  onDesignSettingsChange,
  onOpenFlowSettings,
}: Props) {
  const { t } = useModuleTranslation('playbook');
  const showExecutionsAction = pageMode === 'run' || hasExecutionContext;
  const [runSettingsOpen, setRunSettingsOpen] = useState(false);

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
      {pageMode === 'design' && onOpenFlowSettings && (
        <Button variant="outline" size="sm" className="px-2" title={t('flowSettings.title')} onClick={onOpenFlowSettings}>
          <Settings2 className="h-4 w-4" />
        </Button>
      )}
      {showExecutionsAction && (
        <Button variant="outline" size="sm" onClick={onViewExecutions} className="px-2 sm:px-3">
          <History className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">{t('toolbar.executions')}</span>
        </Button>
      )}
      <Popover open={runSettingsOpen} onOpenChange={setRunSettingsOpen}>
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
          {onTriggers && (
            <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span>{t('toolbar.triggers')}</span>
              <Switch
                checked={triggersOpen}
                onCheckedChange={(checked) => {
                  if (checked) {
                    setRunSettingsOpen(false);
                    onTriggers();
                  }
                }}
              />
            </div>
          )}
          <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
            <span>{t('toolbar.advisor')}</span>
            <Switch checked={nodeReflectionEnabled} onCheckedChange={onNodeReflectionChange} />
          </div>
          {nodeReflectionEnabled && onAdvisorScoringModeChange && (
            <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span>{t('toolbar.scoring')}</span>
              <Select
                value={advisorScoringMode}
                onValueChange={(value: 'llm' | 'heuristic') => onAdvisorScoringModeChange(value)}
              >
                <SelectTrigger className="h-8 w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="llm">{t('toolbar.scoringLlm')}</SelectItem>
                  <SelectItem value="heuristic">{t('toolbar.scoringHeuristic')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {onAdvisorAutopilotChange && (
            <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span>{t('toolbar.stepAutopilot')}</span>
              <Switch checked={advisorAutopilotEnabled} onCheckedChange={onAdvisorAutopilotChange} />
            </div>
          )}
          {designSettings && onDesignSettingsChange && (
            <div className="space-y-3 rounded-md border px-3 py-3">
              <div className="text-sm font-medium">{t('toolbar.aiDefaults.title')}</div>
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">{t('toolbar.aiDefaults.nodeSuggestions')}</div>
                <Select
                  value={designSettings.nodeSuggestionsMode}
                  onValueChange={(value: PlaybookDesignSettings['nodeSuggestionsMode']) => onDesignSettingsChange({ nodeSuggestionsMode: value })}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">{t('toolbar.aiDefaults.inherit')}</SelectItem>
                    <SelectItem value="manual">{t('toolbar.aiDefaults.manual')}</SelectItem>
                    <SelectItem value="auto">{t('toolbar.aiDefaults.auto')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">{t('toolbar.aiDefaults.approvals')}</div>
                <Select
                  value={designSettings.approvalSuggestionMode}
                  onValueChange={(value: PlaybookDesignSettings['approvalSuggestionMode']) => onDesignSettingsChange({ approvalSuggestionMode: value })}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">{t('toolbar.aiDefaults.inherit')}</SelectItem>
                    <SelectItem value="manual">{t('toolbar.aiDefaults.manual')}</SelectItem>
                    <SelectItem value="auto">{t('toolbar.aiDefaults.auto')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
      {isExecuting || hasActiveExecution ? (
        <Button variant="destructive" size="sm" onClick={onStop} disabled={isStopping || !onStop} className="px-2 sm:px-3">
          {isStopping ? (
            <Loader2 className="h-4 w-4 sm:mr-1 animate-spin" />
          ) : (
            <Square className="h-4 w-4 sm:mr-1" />
          )}
          <span className="hidden sm:inline">{isStopping ? t('toolbar.stopping') : t('toolbar.stop')}</span>
        </Button>
      ) : (
        <Button size="sm" onClick={onRun} disabled={!canRun} className="px-2 sm:px-3">
          <Play className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">{t('toolbar.run')}</span>
        </Button>
      )}
    </div>
  );
}
