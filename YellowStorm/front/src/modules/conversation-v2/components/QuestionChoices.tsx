import { Button } from '@/components/ui/button';
import type { PendingQuestion } from '../interfaces/events';
import { useConversationV2Translation } from '../translation';

interface QuestionChoicesProps {
  pendingQuestion: PendingQuestion;
  disabled?: boolean;
  onSelect: (label: string) => void;
}

export function QuestionChoices({ pendingQuestion, disabled = false, onSelect }: QuestionChoicesProps) {
  const { t } = useConversationV2Translation();

  if (!pendingQuestion.options.length) return null;

  return (
    <div className='mx-auto w-full max-w-3xl px-4 pb-3'>
      <div className='rounded-xl border border-border/60 bg-muted/30 p-4'>
        <p className='mb-3 text-sm font-medium text-foreground'>
          {pendingQuestion.questionText || t('questionChoices.fallbackTitle')}
        </p>
        <div className='flex flex-wrap gap-2'>
          {pendingQuestion.options.map((option) => (
            <Button
              key={option.label}
              type='button'
              variant='secondary'
              size='sm'
              disabled={disabled}
              className='h-auto min-h-9 whitespace-normal px-3 py-2 text-left'
              title={option.description}
              onClick={() => onSelect(option.label)}
            >
              <span className='flex flex-col items-start gap-0.5'>
                <span>{option.label}</span>
                {option.description ? (
                  <span className='text-xs font-normal text-muted-foreground'>{option.description}</span>
                ) : null}
              </span>
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
