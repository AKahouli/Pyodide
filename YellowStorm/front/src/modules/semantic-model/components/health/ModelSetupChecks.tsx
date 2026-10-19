import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { useSemanticModelEditorStore } from '../../store';
import type { ConceptSourceMapping, DerivedSource, ModelCheck, ModelCheckIssue, ReviewQueueItem, ValidationIssue } from '../../types';
import { ModelCheckList } from '../review/ModelCheckList';
import { ReviewQueueList, type ReviewQueueHandlers } from '../review/ReviewQueuePanel';

/**
 * Everything wrong with the model before any row is read: the live model check, what the next run is
 * waiting for (sources, unique fields, links, decisions) and the findings of the last structural check.
 */
export function ModelSetupChecks({ modelId, canEdit, items, activeKey, modelCheck, modelCheckFailed = false, checkMappings, checkDerivedSources,
  onOpenCheckIssue, onOpenIssue, validation = [], onOpenValidationIssue, canRunCheck = false, checking = false, onRunCheck }: Readonly<ReviewQueueHandlers & {
  modelId: string;
  canEdit: boolean;
  items: ReviewQueueItem[];
  activeKey?: string | null;
  modelCheck?: ModelCheck;
  modelCheckFailed?: boolean;
  checkMappings?: ConceptSourceMapping[];
  checkDerivedSources?: DerivedSource[];
  onOpenCheckIssue?: (issue: ModelCheckIssue) => void;
  validation?: ValidationIssue[];
  onOpenValidationIssue?: (targetId: string) => void;
  canRunCheck?: boolean;
  checking?: boolean;
  onRunCheck?: () => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const graph = useSemanticModelEditorStore((state) => state.graph);
  return <div className='space-y-6'>
    {(modelCheck || modelCheckFailed) && <section aria-label={t('check.title')}>
      <h3 className='font-semibold'>{t('check.title')}</h3>
      <p className='text-xs text-muted-foreground'>{t('check.description')}</p>
      <ModelCheckList check={modelCheck} loadFailed={modelCheckFailed} mappings={checkMappings} derivedSources={checkDerivedSources} onOpenIssue={onOpenCheckIssue} />
    </section>}
    <section aria-label={t('reviewQueue.title')}>
      <h3 className='font-semibold'>{t('reviewQueue.title')}</h3>
      <p className='text-xs text-muted-foreground'>{t('reviewQueue.description')}</p>
      <ReviewQueueList modelId={modelId} canEdit={canEdit} items={items} activeKey={activeKey} onOpenIssue={onOpenIssue} />
    </section>
    <section aria-label={t('validation.title')}>
      <div className='flex items-center justify-between gap-2'>
        <h3 className='font-semibold'>{t('validation.title')}</h3>
        {onRunCheck && <Button size='sm' variant='outline' className='h-8' disabled={!canRunCheck || checking} onClick={onRunCheck}>
          {checking ? <Loader2 className='me-1.5 h-3.5 w-3.5 animate-spin' /> : <CheckCircle2 className='me-1.5 h-3.5 w-3.5' />}
          {t('action.validate')}
        </Button>}
      </div>
      {validation.length === 0
        ? <p className='mt-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground'>{t('validation.cleanHint')}</p>
        : <div className='mt-3 space-y-2'>{validation.map((issue, index) => <button
            key={`${issue.code}-${issue.targetId}-${index}`}
            type='button'
            className='flex w-full gap-2 rounded-xl border p-3 text-start hover:bg-muted'
            onClick={() => { if (issue.targetId) onOpenValidationIssue?.(issue.targetId); }}
          >
            <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${issue.severity === 'error' ? 'text-destructive' : 'text-amber-600'}`} />
            <span className='min-w-0 text-xs'>
              {issue.targetId && <strong className='block truncate text-sm font-semibold'>{graph?.nodes.find((node) => node.id === issue.targetId)?.label ?? graph?.relations.find((relation) => relation.id === issue.targetId)?.label ?? graph?.records.find((record) => record.id === issue.targetId)?.label}</strong>}
              {t(`validation.issue.${issue.code}`)}
            </span>
          </button>)}</div>}
    </section>
  </div>;
}
