import { BrainCircuit, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';

export interface ReasoningEffortOption {
  id: string;
  name: string;
  description?: string;
}

interface ReasoningEffortSelectorProps {
  efforts: ReasoningEffortOption[];
  value: string | null | undefined;
  onValueChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  fullWidth?: boolean;
}

export function ReasoningEffortSelector({
  efforts,
  value,
  onValueChange,
  label,
  disabled = false,
  fullWidth = false,
}: ReasoningEffortSelectorProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <PromptInputButton
          type='button'
          aria-label={label}
          disabled={disabled}
          className={fullWidth ? 'w-full justify-between' : undefined}
        >
          <BrainCircuit className='h-4 w-4' />
          <span className={fullWidth ? 'flex-1 text-left' : 'hidden sm:inline'}>
            {efforts.find((effort) => effort.id === value)?.name ?? label}
          </span>
          <ChevronDown className='h-3 w-3 opacity-60' />
        </PromptInputButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        className={fullWidth ? 'min-w-[var(--radix-dropdown-menu-trigger-width)]' : undefined}
      >
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value ?? undefined} onValueChange={onValueChange}>
          {efforts.map((effort) => (
            <DropdownMenuRadioItem key={effort.id} value={effort.id} title={effort.description}>
              {effort.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
