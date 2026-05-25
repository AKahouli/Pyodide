import { useMemo, useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useModuleTranslation } from '@/modules/localization';
import { useModelsStore } from '@/modules/models/store';
import { Badge } from '@/components/ui/badge';
import type { Playbook, ReplayMode } from '../types';

interface Props {
  playbook: Playbook;
  disabled?: boolean;
  onRun: (params: { modelIdOverride: string; mode: ReplayMode }) => Promise<void>;
}

const REPLAY_MIGRATION_MODES: ReplayMode[] = ['replay_flex', 'replay_strict', 'replay_adaptive'];

export function ReplayMigrationHarnessCard({ playbook, disabled, onRun }: Props) {
  const { t } = useModuleTranslation('playbook');
  const models = useModelsStore((s) => s.models);
  const fetchModels = useModelsStore((s) => s.fetchModels);
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [selectedMode, setSelectedMode] = useState<ReplayMode>('replay_flex');
  const [isRunning, setIsRunning] = useState(false);

  const activeBaselineCount = useMemo(
    () => playbook.tasks.filter((task) => task.enabled !== false && (task.activeReplayId || task.hasValidatedReplay)).length,
    [playbook.tasks],
  );

  const canRun = activeBaselineCount > 0 && selectedModelId && !disabled && !isRunning;

  const handleRun = async () => {
    if (!canRun) return;
    setIsRunning(true);
    try {
      await onRun({ modelIdOverride: selectedModelId, mode: selectedMode });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="font-medium text-sm">
          {t('migrationHarness.title' as any)}
        </span>
        <Badge variant="outline" className="text-[10px]">
          {t('migrationHarness.baselines' as any, { count: activeBaselineCount } as any)}
        </Badge>
      </div>
      {activeBaselineCount === 0 ? (
        <div className="text-xs text-muted-foreground">
          {t('migrationHarness.noBaselines' as any)}
        </div>
      ) : (
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1">
            <label className="text-xs text-muted-foreground">
              {t('migrationHarness.model' as any)}
            </label>
            <Select value={selectedModelId} onValueChange={setSelectedModelId} onOpenChange={(open) => { if (open) fetchModels(); }}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder={t('migrationHarness.selectModel' as any)} />
              </SelectTrigger>
              <SelectContent>
                {models.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name || model.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              {t('migrationHarness.mode' as any)}
            </label>
            <Select value={selectedMode} onValueChange={(v) => setSelectedMode(v as ReplayMode)}>
              <SelectTrigger className="h-8 text-xs w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REPLAY_MIGRATION_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {t(`execution.mode.${mode === 'replay_flex' ? 'replayFlex' : mode === 'replay_strict' ? 'replayStrict' : 'replayAdaptive'}` as any)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" onClick={handleRun} disabled={!canRun} className="h-8">
            {isRunning ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
            {t('migrationHarness.run' as any)}
          </Button>
        </div>
      )}
    </div>
  );
}
