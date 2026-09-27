import { Activity, ArrowUpRight, Boxes, Library, ListChecks, ShieldCheck, Sparkles, Workflow } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import type { MessageComponent } from '@/modules/conversation/types';
import { SourceSuggestionsCard } from '@/modules/semantic-model/components/assistant/SourceSuggestions';
import { dedupePlatformCopilotUiTargets, executePlatformCopilotUiTarget, findUiTargets, getPlatformCopilotUiTargetIdentity } from './action-bus';
import type { PlatformCopilotPageContext, PlatformCopilotUiTarget } from './types';

export function getTargetPresentation(surface: PlatformCopilotUiTarget['surface']) {
  const presentations = {
    'playbook.list': { icon: Library, labelKey: 'navigation.playbooks', descriptionKey: 'navigation.playbooksDescription' },
    'playbook.editor': { icon: Workflow, labelKey: 'navigation.canvas', descriptionKey: 'navigation.canvasDescription' },
    'playbook.editor.assistant': { icon: Sparkles, labelKey: 'navigation.canvasAssistant', descriptionKey: 'navigation.canvasAssistantDescription' },
    'playbook.validation': { icon: ShieldCheck, labelKey: 'navigation.validation', descriptionKey: 'navigation.validationDescription' },
    'playbook.execution.details': { icon: Activity, labelKey: 'navigation.execution', descriptionKey: 'navigation.executionDescription' },
    'playbook.execution.task': { icon: ListChecks, labelKey: 'navigation.executionTask', descriptionKey: 'navigation.executionTaskDescription' },
    'semanticModel.editor': { icon: Boxes, labelKey: 'navigation.openModel', descriptionKey: 'navigation.openModelDescription' },
    'semanticModel.sources': { icon: Boxes, labelKey: 'navigation.modelSources', descriptionKey: 'navigation.modelSourcesDescription' },
  } as const;
  return presentations[surface];
}

/**
 * The buttons a message's tools asked for. Saved messages keep them next to each tool activity
 * (`uiTargets`); a message still streaming has them in the tool result itself.
 */
export function collectUiTargets(components: readonly MessageComponent[]): PlatformCopilotUiTarget[] {
  return dedupePlatformCopilotUiTargets(components.flatMap((component) => {
    if (component.type !== 'toolActivity') return [];
    const data = component.data as { uiTargets?: unknown; resultJson?: unknown };
    const saved = Array.isArray(data.uiTargets) ? data.uiTargets.map((uiTarget) => ({ uiTarget })) : [];
    return [...findUiTargets(saved), ...findUiTargets(data.resultJson)];
  }));
}

/** One button (or, for suggested sources, the suggestions card) that takes the person where the tool pointed. */
export function UiTargetAction({ target, onOpen, onNavigate }: Readonly<{
  target: PlatformCopilotUiTarget;
  onOpen: () => void;
  onNavigate: (route: string) => void;
}>) {
  const { t } = useModuleTranslation('platform-copilot');
  if (target.surface === 'semanticModel.sources' && target.params.modelId) {
    return <SourceSuggestionsCard modelId={target.params.modelId} modelName={target.params.modelName} onNavigate={onNavigate} />;
  }
  const presentation = getTargetPresentation(target.surface);
  const Icon = presentation.icon;
  const name = target.params.modelName ?? '';
  return (
    <Button
      type='button'
      variant='ghost'
      className='group/action h-auto min-h-11 w-full justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-left shadow-sm hover:border-primary/40 hover:bg-accent'
      onClick={onOpen}>
      <span className='flex min-w-0 items-center gap-3'>
        <span className='grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground group-hover/action:text-foreground'><Icon className='size-4' /></span>
        <span className='min-w-0'>
          <span className='block truncate text-sm font-medium'>{t(presentation.labelKey, { name })}</span>
          <span className='block truncate text-xs font-normal text-muted-foreground'>{t(presentation.descriptionKey)}</span>
        </span>
      </span>
      <ArrowUpRight className='size-4 shrink-0 text-muted-foreground group-hover/action:text-foreground' />
    </Button>
  );
}

/** The buttons under an answer in a conversation page, where nothing unsaved can be lost by leaving. */
export function ConversationUiTargets({ targets }: Readonly<{ targets: PlatformCopilotUiTarget[] }>) {
  const navigate = useNavigate();
  const location = useLocation();
  if (!targets.length) return null;
  const pageContext: PlatformCopilotPageContext = {
    route: location.pathname, module: 'other', surface: 'conversation', availableActions: [], hasUnsavedChanges: false, locale: '', contextVersion: 1,
  };
  return (
    <div data-ui-targets className='space-y-2'>
      {targets.map((target) => <UiTargetAction key={getPlatformCopilotUiTargetIdentity(target)} target={target}
        onOpen={() => executePlatformCopilotUiTarget({ target, pageContext, navigate, confirmNavigation: () => true })}
        onNavigate={(route) => navigate(route)} />)}
    </div>
  );
}
