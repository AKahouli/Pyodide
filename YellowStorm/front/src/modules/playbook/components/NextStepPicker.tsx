/**
 * Shared next-step picker.
 * One catalog popover reused by every creation entry point: node "+", drag into
 * empty space, edge "insert step". Purely presentational — the page computes
 * candidates and commits through the shared graph mutations.
 */

import { useEffect, useMemo, useState } from 'react';
import { GitBranch, Hand, Plus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { useModuleTranslation } from '@/modules/localization';
import { PORT_COLORS } from '../utils/port-colors';
import type { StepBlueprint } from '../utils/step-creation';
import type { TaskTemplate } from '../types';
import { taskChoiceLabel } from '../utils/task-choice-label';

export interface PickerCandidate {
  id: string;
  blueprint: StepBlueprint;
  title: string;
  description: string;
  icon: LucideIcon;
}

const PICKER_WIDTH = 300;
const PICKER_MAX_HEIGHT = 340;

function clampAnchor(anchor: { x: number; y: number }): { left: number; top: number } {
  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - PICKER_WIDTH - 8));
  const top = Math.max(8, Math.min(anchor.y, window.innerHeight - 180));
  return { left, top };
}

export function templateToCandidate(template: TaskTemplate): PickerCandidate {
  const KindIcon = PORT_COLORS[template.inputPorts[0]?.artifactKind || 'text'].icon;
  return {
    id: `template:${template.id}`,
    blueprint: { kind: 'template', template },
    title: template.title,
    description: template.description,
    icon: KindIcon,
  };
}

export interface NextStepPickerProps {
  anchor: { x: number; y: number };
  title: string;
  candidates: PickerCandidate[];
  /** When the source node has several outputs, resolve which one before listing steps. */
  outputChoices?: Array<{ id: string; label: string }> | null;
  onResolveOutput?: (outputId: string) => void;
  onChoose: (candidate: PickerCandidate) => void;
  onCancel: () => void;
}

export function NextStepPicker({
  anchor,
  title,
  candidates,
  outputChoices,
  onResolveOutput,
  onChoose,
  onCancel,
}: NextStepPickerProps) {
  const { t } = useModuleTranslation('playbook');
  const [position, setPosition] = useState(() => clampAnchor(anchor));
  const chooseOutput = Boolean(outputChoices && outputChoices.length > 1 && onResolveOutput);

  useEffect(() => {
    setPosition(clampAnchor(anchor));
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  const groups = useMemo(() => {
    const isControl = (candidate: PickerCandidate) => candidate.blueprint.kind === 'router'
      || candidate.blueprint.kind === 'humanApproval'
      || (candidate.blueprint.kind === 'template'
        && ['iterator', 'router', 'human_approval'].includes(candidate.blueprint.template.nodeType));
    const catalogControls = new Set(candidates.flatMap((candidate) => candidate.blueprint.kind === 'template'
      ? [candidate.blueprint.template.nodeType] : []));
    const distinct = candidates.filter((candidate) => !(candidate.blueprint.kind === 'router' && catalogControls.has('router'))
      && !(candidate.blueprint.kind === 'humanApproval' && catalogControls.has('human_approval')));
    return { presets: distinct.filter((c) => !isControl(c)), templates: distinct.filter(isControl) };
  }, [candidates]);

  return (
    <>
      <div
        className="fixed inset-0 z-[60]"
        onPointerDown={onCancel}
        aria-hidden="true"
        data-next-step-backdrop
      />
      <div
        role="dialog"
        aria-modal="false"
        aria-label={title}
        className="fixed z-[61] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md"
        style={{ left: position.left, top: position.top, width: PICKER_WIDTH, maxHeight: PICKER_MAX_HEIGHT }}
        data-next-step-picker
      >
        <Command loop>
          {chooseOutput ? (
            <>
              <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                {t('nextStep.chooseOutput')}
              </div>
              <CommandList>
                <CommandEmpty>{t('nextStep.empty')}</CommandEmpty>
                <CommandGroup>
                  {outputChoices!.map((output) => (
                    <CommandItem
                      key={output.id}
                      value={output.label}
                      onSelect={() => onResolveOutput?.(output.id)}
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: 'hsl(var(--primary))' }} />
                      <span className="truncate">{output.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </>
          ) : (
            <>
              <CommandInput placeholder={t('nextStep.searchPlaceholder')} className="h-9" />
              <CommandList style={{ maxHeight: PICKER_MAX_HEIGHT - 44 }}>
                <CommandEmpty>{t('nextStep.empty')}</CommandEmpty>
                {groups.presets.length > 0 && (
                  <CommandGroup heading={t('taskChoice.actions')}>
                    {groups.presets.map((candidate) => (
                      <CandidateItem key={candidate.id} candidate={candidate} onChoose={onChoose} />
                    ))}
                  </CommandGroup>
                )}
                {groups.templates.length > 0 && (
                  <CommandGroup heading={t('taskChoice.flowControls')}>
                    {groups.templates.map((candidate) => (
                      <CandidateItem key={candidate.id} candidate={candidate} onChoose={onChoose} />
                    ))}
                  </CommandGroup>
                )}
              </CommandList>
            </>
          )}
        </Command>
      </div>
    </>
  );
}

function CandidateItem({
  candidate,
  onChoose,
}: {
  candidate: PickerCandidate;
  onChoose: (candidate: PickerCandidate) => void;
}) {
  const Icon = candidate.icon;
  const { t } = useModuleTranslation('playbook');
  const title = candidate.blueprint.kind === 'template' ? taskChoiceLabel(candidate.blueprint.template, t) : candidate.title;
  const description = candidate.blueprint.kind === 'template' && title !== candidate.title
    ? t(candidate.blueprint.template.nodeType === 'iterator' ? 'taskChoice.iteratorHint'
      : candidate.blueprint.template.nodeType === 'router' ? 'nextStep.routerHint'
        : 'taskChoice.configureHint')
    : candidate.description;
  return (
    <CommandItem value={`${title} ${candidate.title} ${candidate.description}`} onSelect={() => onChoose(candidate)}>
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="truncate text-sm">{title}</div>
        {description ? (
          <div className="truncate text-xs text-muted-foreground">{description}</div>
        ) : null}
      </div>
    </CommandItem>
  );
}

/** Presets shown in every picker instance; titles come from module i18n. */
export function usePresetCandidates(): PickerCandidate[] {
  const { t } = useModuleTranslation('playbook');
  return useMemo(() => ([
    {
      id: 'preset:blank',
      blueprint: { kind: 'blank' } as StepBlueprint,
      title: t('toolbar.addBlankStep'),
      description: t('nextStep.blankStepHint'),
      icon: Plus,
    },
    {
      id: 'preset:router',
      blueprint: { kind: 'router' } as StepBlueprint,
      title: t('taskChoice.router'),
      description: t('nextStep.routerHint'),
      icon: GitBranch,
    },
    {
      id: 'preset:humanApproval',
      blueprint: { kind: 'humanApproval' } as StepBlueprint,
      title: t('taskChoice.approval'),
      description: t('nextStep.humanApprovalHint'),
      icon: Hand,
    },
  ]), [t]);
}
