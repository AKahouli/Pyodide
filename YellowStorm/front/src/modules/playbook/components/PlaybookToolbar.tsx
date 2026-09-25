import { useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Check,
  CheckCircle2,
  CircleDashed,
  Copy,
  Download,
  History,
  Loader2,
  LocateFixed,
  MoreHorizontal,
  Play,
  Save,
  Settings2,
  Share2,
  Square,
  Upload,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useModuleTranslation } from '@/modules/localization';

import type { PlaybookDesignSettings, PlaybookPageMode } from '../types';
import type { PlaybookValidationIssue } from '../utils/required-port-validation';

interface StatusActionsProps {
  onRun: () => void;
  onStop?: () => void;
  onSave: () => void;
  isDirty: boolean;
  isSaving: boolean;
  isExecuting: boolean;
  hasActiveExecution?: boolean;
  isStopping?: boolean;
  canRun: boolean;
  hasRunnableContent: boolean;
  hasWorkspace: boolean;
  unconfiguredTasks?: Array<{ id: string; title: string; reasons: Array<'agent' | 'action' | 'iteratorSource' | 'evaluationExpectation'> }>;
  validationIssues?: PlaybookValidationIssue[];
  onValidationIssueSelect?: (issue: PlaybookValidationIssue) => void;
  onUnconfiguredTaskSelect?: (taskId: string) => void;
}

interface Props {
  pageMode: PlaybookPageMode;
  onPageModeChange: (mode: PlaybookPageMode) => void;
  hasExecutionContext?: boolean;
  onViewExecutions: () => void;
  nodeReflectionEnabled: boolean;
  onNodeReflectionChange: (enabled: boolean) => void;
  advisorAutopilotEnabled?: boolean;
  onAdvisorAutopilotChange?: (enabled: boolean) => void;
  advisorScoringMode?: import('../types').AdvisorScoringMode;
  onAdvisorScoringModeChange?: (mode: import('../types').AdvisorScoringMode) => void;
  onDownloadAllResults?: () => void;
  canDownloadAllResults?: boolean;
  onTriggers?: () => void;
  triggersEnabled?: boolean;
  designSettings?: PlaybookDesignSettings;
  onDesignSettingsChange?: (settings: Partial<PlaybookDesignSettings>) => void;
  onOpenFlowSettings?: () => void;
  onExport?: () => void;
  onImport?: () => void;
  onEvaluation?: () => void;
  onClone?: () => void;
  onShare?: () => void;
}

export function PlaybookStatusActions({
  onRun,
  onStop,
  onSave,
  isDirty,
  isSaving,
  isExecuting,
  hasActiveExecution = false,
  isStopping = false,
  canRun,
  hasRunnableContent,
  hasWorkspace,
  unconfiguredTasks = [],
  validationIssues = [],
  onValidationIssueSelect,
  onUnconfiguredTaskSelect,
}: StatusActionsProps) {
  const { t } = useModuleTranslation('playbook');
  const [readinessOpen, setReadinessOpen] = useState(false);
  const structuralBlockers = [
    ...(!hasRunnableContent ? [t('toolbar.readiness.missingSteps')] : []),
    ...(!hasWorkspace ? [t('toolbar.readiness.missingWorkspace')] : []),
  ];
  const blockerCount = structuralBlockers.length + unconfiguredTasks.length + validationIssues.length;
  const running = isExecuting || hasActiveExecution;
  const readiness = running
    ? { label: t('toolbar.readiness.running'), icon: Loader2, className: 'border-running/30 bg-running/5 text-running' }
    : isSaving
      ? { label: t('toolbar.readiness.saving'), icon: Loader2, className: 'text-muted-foreground' }
      : isDirty
        ? { label: t('toolbar.readiness.pendingChanges'), icon: CircleDashed, className: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400' }
        : blockerCount > 0
          ? { label: t('toolbar.readiness.blockersCount', { count: blockerCount }), icon: AlertTriangle, className: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400' }
          : { label: t('toolbar.readiness.ready'), icon: CheckCircle2, className: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400' };
  const ReadinessIcon = readiness.icon;
  const saveLabel = isSaving ? t('toolbar.saving') : isDirty ? t('toolbar.save') : t('toolbar.saved');

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Popover open={readinessOpen} onOpenChange={setReadinessOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={`h-11 min-w-11 gap-1.5 px-2 sm:h-9 sm:min-w-9 sm:px-3 ${readiness.className}`}
            aria-label={readiness.label}
          >
            <ReadinessIcon className={`h-4 w-4 ${running || isSaving ? 'animate-spin' : ''}`} />
            <span className="hidden md:inline">{readiness.label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1rem))] p-0">
          <div className="border-b p-3">
            <p className="text-sm font-medium">{t('toolbar.readiness.title')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('toolbar.readiness.description')}</p>
          </div>
          <div className="max-h-80 space-y-1 overflow-y-auto p-2">
            {structuralBlockers.map((blocker) => (
              <div key={blocker} className="flex items-start gap-2 rounded-md px-2 py-2 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <span>{blocker}</span>
              </div>
            ))}
            {unconfiguredTasks.map((task) => (
              <button
                key={task.id}
                type="button"
                className="group flex w-full items-start gap-2 rounded-md p-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  setReadinessOpen(false);
                  onUnconfiguredTaskSelect?.(task.id);
                }}
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{task.title}</span>
                  {task.reasons.map((reason) => (
                    <span key={reason} className="block text-xs text-muted-foreground">{t(`toolbar.readiness.configuration.${reason}`)}</span>
                  ))}
                </span>
                <LocateFixed className="mt-1 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
              </button>
            ))}
            {validationIssues.map((issue) => (
              <button
                key={issue.id}
                type="button"
                className="group flex w-full items-start gap-2 rounded-md p-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  setReadinessOpen(false);
                  onValidationIssueSelect?.(issue);
                }}
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{issue.taskName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t('toolbar.validation.port', { port: issue.portName, type: issue.artifactKind || t('toolbar.validation.unknownType') })}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">{t(`toolbar.validation.reason.${issue.reason}`)}</span>
                  <span className="mt-1 block text-xs">{t(`toolbar.validation.resolution.${issue.reason}`)}</span>
                </span>
                <LocateFixed className="mt-1 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
              </button>
            ))}
            {blockerCount === 0 && !isDirty && !isSaving && !running && (
              <div className="flex items-start gap-2 rounded-md px-2 py-2 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span>{t('toolbar.readiness.readyDescription')}</span>
              </div>
            )}
            {(isDirty || isSaving) && (
              <div className="flex items-start gap-2 rounded-md px-2 py-2 text-sm">
                <Save className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>{isSaving ? t('toolbar.readiness.savingDescription') : t('toolbar.readiness.pendingDescription')}</span>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <Button
        variant={isDirty ? 'outline' : 'ghost'}
        size="sm"
        onClick={onSave}
        disabled={!isDirty || isSaving}
        className="h-11 min-w-11 px-2 sm:h-9 sm:min-w-9 sm:px-3"
        aria-label={saveLabel}
        title={saveLabel}
      >
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : isDirty ? <Save className="h-4 w-4" /> : <Check className="h-4 w-4" />}
        <span className="ml-1.5 hidden lg:inline">{saveLabel}</span>
      </Button>

      {running ? (
        <Button
          variant="destructive"
          size="sm"
          onClick={onStop}
          disabled={isStopping || !onStop}
          className="h-11 min-w-11 px-2 sm:h-9 sm:min-w-9 sm:px-3"
          aria-label={isStopping ? t('toolbar.stopping') : t('toolbar.stop')}
        >
          {isStopping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
          <span className="ml-1.5 hidden sm:inline">{isStopping ? t('toolbar.stopping') : t('toolbar.stop')}</span>
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={onRun}
          disabled={!canRun}
          className="h-11 min-w-11 px-2 sm:h-9 sm:min-w-9 sm:px-3"
          aria-label={t('toolbar.run')}
        >
          <Play className="h-4 w-4" />
          <span className="ml-1.5 hidden sm:inline">{t('toolbar.run')}</span>
        </Button>
      )}
    </div>
  );
}

export function PlaybookToolbar({
  pageMode,
  onPageModeChange,
  hasExecutionContext = false,
  onViewExecutions,
  nodeReflectionEnabled,
  onNodeReflectionChange,
  advisorAutopilotEnabled = false,
  onAdvisorAutopilotChange,
  advisorScoringMode = 'llm',
  onAdvisorScoringModeChange,
  onDownloadAllResults,
  canDownloadAllResults = false,
  onTriggers,
  triggersEnabled = false,
  designSettings,
  onDesignSettingsChange,
  onOpenFlowSettings,
  onExport,
  onImport,
  onEvaluation,
  onClone,
  onShare,
}: Props) {
  const { t } = useModuleTranslation('playbook');
  const showExecutionsAction = pageMode === 'run' || hasExecutionContext;
  const [runSettingsOpen, setRunSettingsOpen] = useState(false);

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <div className="flex items-center rounded-md border p-0.5">
        {(['design', 'run'] as const).map((mode) => (
          <Button
            key={mode}
            type="button"
            variant={pageMode === mode ? 'secondary' : 'ghost'}
            size="sm"
            className="h-10 px-2 sm:h-8 sm:px-3"
            onClick={() => onPageModeChange(mode)}
          >
            {t(mode === 'run' ? 'mode.monitor' : 'mode.design')}
          </Button>
        ))}
      </div>

      <Popover open={runSettingsOpen} onOpenChange={setRunSettingsOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-11 min-w-11 px-2 sm:h-9 sm:min-w-9" aria-label={t('toolbar.runSettings')} title={t('toolbar.runSettings')}>
            <Settings2 className="h-4 w-4" />
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
                aria-label={t('toolbar.triggers')}
                checked={triggersEnabled}
                onCheckedChange={() => {
                  setRunSettingsOpen(false);
                  onTriggers();
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
              <Select value={advisorScoringMode} onValueChange={(value: 'llm' | 'heuristic') => onAdvisorScoringModeChange(value)}>
                <SelectTrigger className="h-8 w-[130px]"><SelectValue /></SelectTrigger>
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
                <Select value={designSettings.nodeSuggestionsMode} onValueChange={(value: PlaybookDesignSettings['nodeSuggestionsMode']) => onDesignSettingsChange({ nodeSuggestionsMode: value })}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">{t('toolbar.aiDefaults.inherit')}</SelectItem>
                    <SelectItem value="manual">{t('toolbar.aiDefaults.manual')}</SelectItem>
                    <SelectItem value="auto">{t('toolbar.aiDefaults.auto')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">{t('toolbar.aiDefaults.approvals')}</div>
                <Select value={designSettings.approvalSuggestionMode} onValueChange={(value: PlaybookDesignSettings['approvalSuggestionMode']) => onDesignSettingsChange({ approvalSuggestionMode: value })}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
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

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-11 min-w-11 px-2 sm:h-9 sm:min-w-9" aria-label={t('toolbar.moreActions')} title={t('toolbar.moreActions')}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {showExecutionsAction && <DropdownMenuItem onClick={onViewExecutions}><History className="mr-2 h-4 w-4" />{t('toolbar.executions')}</DropdownMenuItem>}
          {pageMode === 'design' && onOpenFlowSettings && <DropdownMenuItem onClick={onOpenFlowSettings}><Settings2 className="mr-2 h-4 w-4" />{t('flowSettings.title')}</DropdownMenuItem>}
          {onEvaluation && <DropdownMenuItem onClick={onEvaluation}><BarChart3 className="mr-2 h-4 w-4" />{t('header.evaluation')}</DropdownMenuItem>}
          {onClone && <DropdownMenuItem onClick={onClone}><Copy className="mr-2 h-4 w-4" />{t('header.clonePlaybook')}</DropdownMenuItem>}
          {onShare && <DropdownMenuItem onClick={onShare}><Share2 className="mr-2 h-4 w-4" />{t('share.share')}</DropdownMenuItem>}
          {(onDownloadAllResults || onImport || onExport) && <DropdownMenuSeparator />}
          {onDownloadAllResults && <DropdownMenuItem onClick={onDownloadAllResults} disabled={!canDownloadAllResults}><Download className="mr-2 h-4 w-4" />{t('execution.downloadAllResults')}</DropdownMenuItem>}
          {onImport && <DropdownMenuItem onClick={onImport}><Upload className="mr-2 h-4 w-4" />{t('toolbar.import')}</DropdownMenuItem>}
          {onExport && <DropdownMenuItem onClick={onExport}><Download className="mr-2 h-4 w-4" />{t('toolbar.export')}</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
