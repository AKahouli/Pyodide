import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { useSemanticModelEditorStore } from '../../store';
import type { ConceptSourceMapping, DerivedSource, ModelCheck, ModelCheckIssue } from '../../types';
import { groupModelCheck, issueText, type CheckGroup } from '../../utils/model-check';

type Translate = (key: string | string[], options?: Record<string, unknown>) => string;

/** Every problem the model check found, by the concept, relationship or source it is fixed on; errors first, each a way in to fix it. */
export function ModelCheckList({ check, loadFailed = false, mappings = [], derivedSources = [], onOpenIssue }: Readonly<{
  /** Undefined while loading or when it could not be loaded. */
  check?: ModelCheck;
  loadFailed?: boolean;
  mappings?: ConceptSourceMapping[];
  derivedSources?: DerivedSource[];
  onOpenIssue?: (issue: ModelCheckIssue) => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const translate = t as Translate;
  const graph = useSemanticModelEditorStore((state) => state.graph);
  if (!check) return loadFailed ? <p className='mt-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground'>{translate('check.unavailable')}</p> : null;
  if (!check.issues.length) return <p className='mt-3 flex items-center gap-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground'><CheckCircle2 className='h-4 w-4 text-emerald-600' />{translate('check.clean')}</p>;

  const conceptLabel = (id: string | undefined) => graph?.nodes.find((node) => node.id === id)?.label;
  const titleOf = (group: CheckGroup): string => {
    if (group.kind === 'model') return translate('check.group.model');
    let name: string | undefined;
    if (group.kind === 'concept') name = conceptLabel(group.id);
    else if (group.kind === 'relation') name = graph?.relations.find((relation) => relation.id === group.id)?.label;
    else if (group.kind === 'mapping') {
      const mapping = mappings.find((item) => item.id === group.id);
      name = mapping && [conceptLabel(mapping.conceptId), mapping.sheetName || mapping.documentName].filter(Boolean).join(' · ');
    } else {
      const derived = derivedSources.find((item) => item.id === group.id);
      name = derived && [conceptLabel(derived.sourceConceptId), conceptLabel(derived.conceptId)].filter(Boolean).join(' → ');
    }
    return name ? translate(`check.group.${group.kind}`, { name }) : translate('check.group.unknown');
  };

  return <div className='mt-3 space-y-3'>
    <p className='flex flex-wrap gap-x-3 text-xs font-medium'>
      {check.errorCount > 0 && <span className='text-destructive'>{translate('check.errorCount', { count: check.errorCount })}</span>}
      {check.warningCount > 0 && <span className='text-amber-700 dark:text-amber-400'>{translate('check.warningCount', { count: check.warningCount })}</span>}
    </p>
    {groupModelCheck(check.issues).map((group) => <div key={`${group.kind}:${group.id}`} className='rounded-xl border p-2'>
      <h4 className='truncate px-1.5 pb-1 text-sm font-semibold' title={titleOf(group)}>{titleOf(group)}</h4>
      <ul className='space-y-0.5'>{group.issues.map((issue, index) => <li key={`${issue.code}-${issue.fieldId ?? ''}-${index}`}>
        <button type='button' onClick={() => onOpenIssue?.(issue)} data-severity={issue.severity}
          className='flex w-full gap-2 rounded-lg p-1.5 text-left text-xs hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary'>
          {issue.severity === 'error' ? <AlertCircle className='mt-0.5 h-4 w-4 shrink-0 text-destructive' aria-hidden /> : <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0 text-amber-600' aria-hidden />}
          <span className='min-w-0 whitespace-normal break-words'>{issueText(translate, issue)}</span>
        </button>
      </li>)}</ul>
    </div>)}
  </div>;
}
