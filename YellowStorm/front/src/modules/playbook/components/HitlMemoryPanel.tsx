import { Badge } from '@/components/ui/badge';
import { useModuleTranslation } from '@/modules/localization';
import { useHitlMemoriesQuery } from '@/modules/playbook/query/hooks/useHitlQueries';
import type { HitlMemory } from '@/modules/playbook/types';

type HitlMemoryPanelProps = Readonly<{
  flowId: string;
}>;

type PlaybookTranslation = ReturnType<typeof useModuleTranslation<'playbook'>>['t'];

function getMemorySourceLabel(memory: HitlMemory, t: PlaybookTranslation) {
  if (memory.source === 'hitl_feedback') return t('hitl.memory.source.hitl_feedback');
  if (memory.source === 'blocker_rule') return t('hitl.memory.source.blocker_rule');
  if (memory.source === 'replay_validation') return t('hitl.memory.source.replay_validation');
  return t('hitl.memory.source.manual');
}

function getMemorySensitivityLabel(memory: HitlMemory, t: PlaybookTranslation) {
  return memory.sensitivity === 'sensitive'
    ? t('hitl.memory.sensitivity.sensitive')
    : t('hitl.memory.sensitivity.normal');
}

function getMemoryScopeLabel(memory: HitlMemory, t: PlaybookTranslation) {
  if (memory.appliesTo === 'node') return t('hitl.memory.scope.node');
  if (memory.appliesTo === 'agent') return t('hitl.memory.scope.agent');
  if (memory.appliesTo === 'workspace') return t('hitl.memory.scope.workspace');
  return t('hitl.memory.scope.workflow');
}

/** Lists persisted HITL memories so users can see which guidance may affect future workflow runs. */
export function HitlMemoryPanel({ flowId }: HitlMemoryPanelProps) {
  const { t } = useModuleTranslation('playbook');
  const memoriesQuery = useHitlMemoriesQuery(flowId);
  const memories = memoriesQuery.data ?? [];

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">{t('hitl.memory.title')}</p>
        <p className="text-xs text-muted-foreground">{t('hitl.memory.description')}</p>
      </div>
      {memories.length === 0 ? (
        <div className="rounded-lg border border-dashed px-3 py-4 text-xs text-muted-foreground">
          {t('hitl.memory.empty')}
        </div>
      ) : (
        <div className="space-y-2">
          {memories.map((memory) => (
            <div key={memory.id} className="rounded-lg border bg-background p-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-sm font-medium">{memory.title}</p>
                <Badge variant="outline">{memory.status}</Badge>
                <Badge variant="outline">{getMemoryScopeLabel(memory, t)}</Badge>
                <Badge variant="secondary">{getMemorySourceLabel(memory, t)}</Badge>
                <Badge variant={memory.sensitivity === 'sensitive' ? 'destructive' : 'outline'}>
                  {getMemorySensitivityLabel(memory, t)}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{memory.normalizedInstruction}</p>
              <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                {memory.createdFromInterruptId && (
                  <p>{t('hitl.memory.createdFromInterrupt', { interruptId: memory.createdFromInterruptId })}</p>
                )}
                {memory.createdFromExecutionId && (
                  <p>{t('hitl.memory.createdFromExecution', { executionId: memory.createdFromExecutionId })}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
