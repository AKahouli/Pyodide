import { Activity, ArrowUpRight, Boxes, FolderSearch, Library, ListChecks, ShieldCheck, Sparkles, Workflow } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import type { MessageComponent } from '@/modules/conversation/types';
import { SourceSuggestionsCard } from '@/modules/semantic-model/components/assistant/SourceSuggestions';
import { PlaybookRunStatus } from '@/modules/playbook/components/assistant/PlaybookRunStatus';
import { PlaybookSourcesCard } from '@/modules/playbook/components/assistant/PlaybookSourcesCard';
import { dedupePlatformCopilotUiTargets, executePlatformCopilotUiTarget, findUiTargets, getPlatformCopilotUiTargetIdentity } from './action-bus';
import type { PlatformCopilotPageContext, PlatformCopilotUiTarget } from './types';

export function getTargetPresentation(surface: PlatformCopilotUiTarget['surface']) {
  const presentations = {
    'playbook.list': { icon: Library, labelKey: 'navigation.playbooks', descriptionKey: 'navigation.playbooksDescription' },
    'playbook.editor': { icon: Workflow, labelKey: 'navigation.canvas', namedLabelKey: 'navigation.canvasNamed', descriptionKey: 'navigation.canvasDescription' },
    'playbook.editor.assistant': { icon: Sparkles, labelKey: 'navigation.canvasAssistant', namedLabelKey: 'navigation.canvasAssistantNamed', descriptionKey: 'navigation.canvasAssistantDescription' },
    'playbook.validation': { icon: ShieldCheck, labelKey: 'navigation.validation', namedLabelKey: 'navigation.validationNamed', descriptionKey: 'navigation.validationDescription' },
    'playbook.execution.details': { icon: Activity, labelKey: 'navigation.execution', namedLabelKey: 'navigation.executionNamed', descriptionKey: 'navigation.executionDescription' },
    'playbook.execution.task': { icon: ListChecks, labelKey: 'navigation.executionTask', namedLabelKey: 'navigation.executionTaskNamed', descriptionKey: 'navigation.executionTaskDescription' },
    'semanticModel.editor': { icon: Boxes, labelKey: 'navigation.openModel', descriptionKey: 'navigation.openModelDescription' },
    'semanticModel.sources': { icon: Boxes, labelKey: 'navigation.modelSources', descriptionKey: 'navigation.modelSourcesDescription' },
    'playbook.sources': { icon: FolderSearch, labelKey: 'navigation.playbookSources', descriptionKey: 'navigation.playbookSourcesDescription' },
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

/**
 * One button that takes the person where the tool pointed, or a card for what they decide in the conversation:
 * the suggested sources of a semantic model, the sources of a playbook Yellowmind is designing.
 */
export function UiTargetAction({ target, onOpen, onNavigate, onSend }: Readonly<{
  target: PlatformCopilotUiTarget;
  onOpen: () => void;
  onNavigate: (route: string) => void;
  /** Sends a message to Yellowmind, for a card that tells it to continue. */
  onSend?: (text: string) => Promise<boolean> | boolean | void;
}>) {
  const { t } = useModuleTranslation('platform-copilot');
  if (target.surface === 'semanticModel.sources' && target.params.modelId) {
    return <SourceSuggestionsCard modelId={target.params.modelId} modelName={target.params.modelName} onNavigate={onNavigate} />;
  }
  if (target.surface === 'playbook.sources' && target.params.continuationId) {
    return <PlaybookSourcesCard continuationId={target.params.continuationId} playbookName={target.params.playbookName} onSend={onSend} />;
  }
  const presentation = getTargetPresentation(target.surface);
  const Icon = presentation.icon;
  const name = target.params.modelName ?? target.params.playbookName ?? '';
  // A playbook button reads "Open CV screening" when the tool gave the playbook's name.
  const labelKey = target.params.playbookName && 'namedLabelKey' in presentation ? presentation.namedLabelKey : presentation.labelKey;
  const button = (
    <Button
      type='button'
      variant='ghost'
      className='group/action h-auto min-h-11 w-full justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-left shadow-sm hover:border-primary/40 hover:bg-accent'
      onClick={onOpen}>
      <span className='flex min-w-0 items-center gap-3'>
        <span className='grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground group-hover/action:text-foreground'><Icon className='size-4' /></span>
        <span className='min-w-0'>
          <span className='block truncate text-sm font-medium'>{t(labelKey, { name })}</span>
          <span className='block truncate text-xs font-normal text-muted-foreground'>{t(presentation.descriptionKey)}</span>
        </span>
      </span>
      <ArrowUpRight className='size-4 shrink-0 text-muted-foreground group-hover/action:text-foreground' />
    </Button>
  );
  const executionId = target.params.executionId;
  if ((target.surface === 'playbook.execution.details' || target.surface === 'playbook.execution.task') && executionId) {
    return <div className='space-y-1.5'>{button}<PlaybookRunStatus executionId={executionId} /></div>;
  }
  return button;
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
