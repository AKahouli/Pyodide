import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { ChoiceComponentData, ChoiceInteractionMetadata } from '@/modules/conversation/types';
import { useModuleTranslation } from '@/modules/localization';
import { ChoiceOptionsList, choiceDisplayText, choiceSubmitText, EMPTY_CHOICE_SELECTION, isChoiceAnswered, type ChoiceOptionsSelection } from './choice-options';
import type { ChoiceComponentAction } from './ChoicePartRenderer';

export interface ChoiceTabsQuestion {
  componentId: string;
  choice: ChoiceComponentData;
}

export interface ChoiceTabsQuestionsProps {
  questions: ChoiceTabsQuestion[];
  onSubmitAll?: (actions: ChoiceComponentAction[]) => Promise<void>;
  submittedInteractions?: Map<string, ChoiceInteractionMetadata>;
  externallyDisabled?: boolean;
}

function tabLabel(question: ChoiceTabsQuestion, index: number): string {
  const prompt = question.choice.prompt.trim();
  if (prompt.length <= 24) return prompt || `Question ${index + 1}`;
  return `${prompt.slice(0, 21).trimEnd()}…`;
}

export function ChoiceTabsQuestions({ questions, onSubmitAll, submittedInteractions, externallyDisabled = false }: Readonly<ChoiceTabsQuestionsProps>) {
  const { t } = useModuleTranslation('conversation');
  const [selections, setSelections] = useState<Record<string, ChoiceOptionsSelection>>({});
  const [state, setState] = useState<'idle' | 'submitting' | 'submitted' | 'error'>('idle');

  const answeredByComponentId = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const question of questions) {
      map.set(question.componentId, isChoiceAnswered(question.choice, selections[question.componentId] ?? EMPTY_CHOICE_SELECTION));
    }
    return map;
  }, [questions, selections]);

  const allAnswered = questions.length > 0 && questions.every((question) => {
    if (submittedInteractions?.has(question.componentId)) return true;
    return answeredByComponentId.get(question.componentId) ?? false;
  });
  const allSubmitted = questions.length > 0 && questions.every((question) => submittedInteractions?.has(question.componentId));
  const disabled = externallyDisabled || state === 'submitting' || state === 'submitted' || (questions.length > 0 && questions.every((q) => q.choice.status !== 'ready'));

  const updateSelection = (componentId: string, updater: (current: ChoiceOptionsSelection) => ChoiceOptionsSelection) => {
    setSelections((current) => ({ ...current, [componentId]: updater(current[componentId] ?? EMPTY_CHOICE_SELECTION) }));
  };

  const toggle = (componentId: string, choice: ChoiceComponentData, optionId: string) => {
    const option = choice.options.find((item) => item.id === optionId);
    if (!option || option.disabled) return;
    updateSelection(componentId, (current) => {
      const next = choice.selectionMode === 'single' ? [optionId] : current.selected.includes(optionId) ? current.selected.filter((id) => id !== optionId) : [...current.selected, optionId];
      return { ...current, selected: next, ...(choice.selectionMode === 'single' ? { otherSelected: false, customAnswer: '' } : {}) };
    });
  };

  const toggleOther = (componentId: string, choice: ChoiceComponentData) => {
    if (!choice.otherOption?.enabled) return;
    updateSelection(componentId, (current) => {
      if (current.otherSelected) return { ...current, otherSelected: false, customAnswer: '' };
      return { ...current, otherSelected: true, ...(choice.selectionMode === 'single' ? { selected: [] } : {}) };
    });
  };

  const submitAll = async () => {
    if (disabled || !onSubmitAll || !allAnswered) return;
    setState('submitting');
    try {
      const actions: ChoiceComponentAction[] = questions.map(({ componentId, choice }) => {
        const selection = selections[componentId] ?? EMPTY_CHOICE_SELECTION;
        const selectedOptions = choice.options.filter((option) => selection.selected.includes(option.id)).map((option) => ({ optionId: option.id, label: option.label, ...(option.value ? { value: option.value } : {}) }));
        const customAnswer = selection.otherSelected ? selection.customAnswer.trim() : '';
        const displayText = choiceDisplayText(choice, selection);
        return {
          componentId,
          submitText: choiceSubmitText(choice, selection),
          displayText,
          interaction: {
            type: 'choice', componentId, questionId: choice.questionId, selectionMode: choice.selectionMode,
            selectedOptions, ...(customAnswer ? { customAnswer } : {}), displayText,
          },
        };
      });
      await onSubmitAll(actions);
      setState('submitted');
    } catch {
      setState('error');
    }
  };

  if (allSubmitted) {
    return <div className='rounded-lg border bg-muted/40 p-3 text-sm'>{t('choice.submitted')}</div>;
  }

  return (
    <section className='space-y-3 rounded-xl border bg-card p-4' aria-label={t('choice.tabsAriaLabel')}>
      <Tabs defaultValue={questions[0]?.componentId} className='w-full'>
        <TabsList className='flex w-full flex-wrap' variant='line'>
          {questions.map((question, index) => {
            const answered = submittedInteractions?.has(question.componentId) ?? answeredByComponentId.get(question.componentId) ?? false;
            return (
              <TabsTrigger key={question.componentId} value={question.componentId} className='min-w-0 max-w-48 flex-1' title={question.choice.prompt}>
                <span className='truncate'>{tabLabel(question, index)}</span>
                {answered && <span className='ml-1 shrink-0 text-[10px] font-semibold text-primary' aria-label={t('choice.answered')}>✓</span>}
              </TabsTrigger>
            );
          })}
        </TabsList>
        {questions.map(({ componentId, choice }) => {
          const submitted = submittedInteractions?.get(componentId);
          if (submitted) {
            return (
              <TabsContent key={componentId} value={componentId}>
                <div className='rounded-lg border bg-muted/40 p-3 text-sm'>{submitted.dismissed ? t('choice.dismissed') : t('choice.submitted')}</div>
              </TabsContent>
            );
          }
          const selection = selections[componentId] ?? EMPTY_CHOICE_SELECTION;
          return (
            <TabsContent key={componentId} value={componentId} className='space-y-3'>
              <div>
                <h3 className='font-medium'>{choice.prompt}</h3>
                {choice.description && <p className='mt-1 text-sm text-muted-foreground'>{choice.description}</p>}
              </div>
              <ChoiceOptionsList
                choice={choice}
                selection={selection}
                disabled={disabled}
                onToggle={(optionId) => toggle(componentId, choice, optionId)}
                onToggleOther={() => toggleOther(componentId, choice)}
                onCustomAnswerChange={(value) => updateSelection(componentId, (current) => ({ ...current, customAnswer: value }))}
              />
            </TabsContent>
          );
        })}
      </Tabs>
      <div className={cn('flex flex-wrap items-center justify-end gap-2 border-t pt-3')}>
        <p className='mr-auto text-xs text-muted-foreground'>{t('choice.tabsProgress', { current: questions.filter((q) => submittedInteractions?.has(q.componentId) ?? answeredByComponentId.get(q.componentId)).length, total: questions.length })}</p>
        <Button type='button' onClick={() => void submitAll()} disabled={disabled || !allAnswered}>{t('choice.submitAll')}</Button>
        {state === 'error' && <p className='text-sm text-destructive'>{t('choice.sendError')}</p>}
      </div>
    </section>
  );
}
