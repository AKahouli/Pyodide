import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
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

export function ChoiceTabsQuestions({ questions, onSubmitAll, submittedInteractions, externallyDisabled = false }: Readonly<ChoiceTabsQuestionsProps>) {
  const { t } = useModuleTranslation('conversation');
  const [selections, setSelections] = useState<Record<string, ChoiceOptionsSelection>>({});
  const [state, setState] = useState<'idle' | 'submitting' | 'submitted' | 'error'>('idle');
  const [page, setPage] = useState(0);

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
  const activeIndex = Math.min(page, Math.max(questions.length - 1, 0));
  const activeQuestion = questions[activeIndex];
  const activeAnswered = activeQuestion
    ? Boolean(submittedInteractions?.has(activeQuestion.componentId) || answeredByComponentId.get(activeQuestion.componentId))
    : false;

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
      <div className='flex items-center justify-between gap-3'>
        <p className='text-xs font-medium text-muted-foreground'>{t('choice.questionProgress', { current: activeIndex + 1, total: questions.length })}</p>
        <div className='flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1' role='group' aria-label={t('choice.questionNavigation')}>
          {questions.map((question, index) => {
            const answered = Boolean(submittedInteractions?.has(question.componentId) || answeredByComponentId.get(question.componentId));
            return (
              <button
                key={question.componentId}
                type='button'
                aria-current={index === activeIndex ? 'step' : undefined}
                aria-label={t('choice.goToQuestion', { current: index + 1, prompt: question.choice.prompt })}
                title={question.choice.prompt}
                onClick={() => setPage(index)}
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-full border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  index === activeIndex ? 'border-primary bg-primary text-primary-foreground' : answered ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted',
                )}
              >
                {answered ? <span aria-label={t('choice.answered')}>✓</span> : index + 1}
              </button>
            );
          })}
        </div>
      </div>
      {activeQuestion && (() => {
        const { componentId, choice } = activeQuestion;
        const submitted = submittedInteractions?.get(componentId);
        if (submitted) return <div className='rounded-lg border bg-muted/40 p-3 text-sm'>{submitted.dismissed ? t('choice.dismissed') : t('choice.submitted')}</div>;
        const selection = selections[componentId] ?? EMPTY_CHOICE_SELECTION;
        return (
          <div className='space-y-3'>
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
          </div>
        );
      })()}
      <div className={cn('flex flex-wrap items-center justify-end gap-2 border-t pt-3')}>
        <p className='mr-auto text-xs text-muted-foreground'>{t('choice.tabsProgress', { current: questions.filter((q) => submittedInteractions?.has(q.componentId) || answeredByComponentId.get(q.componentId)).length, total: questions.length })}</p>
        {activeIndex > 0 && <Button type='button' variant='outline' onClick={() => setPage(activeIndex - 1)} disabled={disabled}>{t('choice.back')}</Button>}
        {activeIndex < questions.length - 1
          ? <Button type='button' onClick={() => setPage(activeIndex + 1)} disabled={disabled || !activeAnswered}>{t('choice.next')}</Button>
          : <Button type='button' onClick={() => void submitAll()} disabled={disabled || !allAnswered}>{t('choice.submitAll')}</Button>}
        {state === 'error' && <p className='text-sm text-destructive'>{t('choice.sendError')}</p>}
      </div>
    </section>
  );
}
