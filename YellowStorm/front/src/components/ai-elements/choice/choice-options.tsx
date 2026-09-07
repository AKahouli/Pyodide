import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { ChoiceComponentData } from '@/modules/conversation/types';

export interface ChoiceOptionsSelection {
  selected: string[];
  otherSelected: boolean;
  customAnswer: string;
}

export const EMPTY_CHOICE_SELECTION: ChoiceOptionsSelection = { selected: [], otherSelected: false, customAnswer: '' };

export function isChoiceAnswered(choice: ChoiceComponentData, selection: ChoiceOptionsSelection): boolean {
  const customAnswerValue = selection.otherSelected ? selection.customAnswer.trim() : '';
  if (choice.selectionMode === 'single') {
    if (customAnswerValue) return true;
    return choice.options.some((option) => selection.selected.includes(option.id));
  }
  return selection.selected.length > 0 || Boolean(customAnswerValue);
}

export function choiceDisplayText(choice: ChoiceComponentData, selection: ChoiceOptionsSelection): string {
  const parts = choice.options.filter((option) => selection.selected.includes(option.id)).map((option) => option.label);
  if (selection.otherSelected && selection.customAnswer.trim()) parts.push(selection.customAnswer.trim());
  return parts.join(', ');
}

export function choiceSubmitText(choice: ChoiceComponentData, selection: ChoiceOptionsSelection): string {
  if (selection.otherSelected && selection.customAnswer.trim()) {
    return choice.selectionMode === 'multiple'
      ? [...choice.options.filter((option) => selection.selected.includes(option.id)).map((option) => option.submitText), selection.customAnswer.trim()].join(' ')
      : selection.customAnswer.trim();
  }
  return choice.options.filter((option) => selection.selected.includes(option.id)).map((option) => option.submitText).join(' ');
}

interface ChoiceOptionsListProps {
  choice: ChoiceComponentData;
  selection: ChoiceOptionsSelection;
  disabled: boolean;
  onToggle: (optionId: string) => void;
  onToggleOther: () => void;
  onCustomAnswerChange: (value: string) => void;
}

export function ChoiceOptionsList({ choice, selection, disabled, onToggle, onToggleOther, onCustomAnswerChange }: ChoiceOptionsListProps) {
  return (
    <>
      <div className={choice.presentation === 'quick_replies' ? 'flex flex-wrap gap-2' : 'flex flex-col gap-2'} role={choice.selectionMode === 'single' ? 'radiogroup' : 'group'}>
        {choice.options.map((option) => {
          const isSelected = selection.selected.includes(option.id);
          return (
            <div key={option.id} className='flex items-center gap-2'>
              <button
                type='button'
                disabled={disabled || option.disabled}
                onClick={() => onToggle(option.id)}
                role={choice.selectionMode === 'single' ? 'radio' : 'checkbox'}
                aria-checked={isSelected}
                data-selected={isSelected}
                className={cn('min-h-11 flex-1 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60', isSelected ? 'border-primary bg-primary/10 ring-1 ring-primary/30' : 'border-border hover:bg-muted/60')}
              >
                <span className='font-medium'>{option.label}</span>
                {option.description && <span className='mt-1 block text-sm text-muted-foreground'>{option.description}</span>}
              </button>
              {option.url ? <a href={option.url} target='_blank' rel='noopener noreferrer' className='text-sm text-primary underline underline-offset-4'>Open</a> : null}
            </div>
          );
        })}
        {choice.otherOption?.enabled && (
          <button
            type='button'
            disabled={disabled}
            onClick={onToggleOther}
            role={choice.selectionMode === 'single' ? 'radio' : 'checkbox'}
            aria-checked={selection.otherSelected}
            data-selected={selection.otherSelected}
            data-other-option='true'
            className={cn('min-h-11 rounded-lg border px-3 py-2 text-left font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60', selection.otherSelected ? 'border-primary bg-primary/10 ring-1 ring-primary/30' : 'border-border hover:bg-muted/60')}
          >
            {choice.otherOption.label}
          </button>
        )}
      </div>
      {choice.otherOption?.enabled && selection.otherSelected && (
        <Textarea
          value={selection.customAnswer}
          maxLength={choice.otherOption.maxLength}
          aria-label={choice.otherOption.label}
          placeholder={choice.otherOption.placeholder}
          onChange={(event) => onCustomAnswerChange(event.target.value)}
          disabled={disabled}
        />
      )}
    </>
  );
}
