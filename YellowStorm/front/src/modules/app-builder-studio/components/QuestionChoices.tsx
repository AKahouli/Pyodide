import { useState } from 'react';
import { CheckIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PendingQuestion } from '../interfaces/events';
import { useAppBuilderStudioTranslation } from '../translation';

interface QuestionChoicesProps {
  pendingQuestion: PendingQuestion;
  disabled?: boolean;
  onSelect: (label: string) => void;
}

export function QuestionChoices({ pendingQuestion, disabled = false, onSelect }: QuestionChoicesProps) {
  const { t } = useAppBuilderStudioTranslation();
  // Latch the answer locally so the picked option stays visibly selected while
  // the round-trip to the agent is still in flight — otherwise the buttons
  // simply grey out and the user cannot tell which option they chose.
  const [answered, setAnswered] = useState<string | null>(null);

  if (!pendingQuestion.options.length) return null;

  return (
    <div className='mx-auto w-full max-w-3xl px-4 pb-3'>
      <div className='rounded-xl border border-border/60 bg-muted/30 p-4'>
        <p className='mb-3 text-sm font-medium text-foreground'>
          {pendingQuestion.questionText || t('questionChoices.fallbackTitle')}
        </p>
        <div className='flex flex-wrap gap-2'>
          {pendingQuestion.options.map((option) => {
            const selected = answered === option.label;
            return (
              <Button
                key={option.label}
                type='button'
                variant={selected ? 'default' : 'secondary'}
                size='sm'
                disabled={disabled || answered !== null}
                aria-pressed={selected}
                className={cn(
                  'h-auto min-h-9 gap-1.5 whitespace-normal px-3 py-2 text-left transition-colors',
                  answered !== null && !selected && 'opacity-50',
                )}
                title={option.description}
                onClick={() => {
                  setAnswered(option.label);
                  onSelect(option.label);
                }}
              >
                {selected && <CheckIcon className='size-3.5 shrink-0' aria-hidden />}
                <span className='flex flex-col items-start gap-0.5'>
                  <span>{option.label}</span>
                  {option.description ? (
                    <span className='text-xs font-normal text-muted-foreground'>{option.description}</span>
                  ) : null}
                </span>
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
