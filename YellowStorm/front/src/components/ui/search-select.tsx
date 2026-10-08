import * as React from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface SearchSelectOption {
  value: string;
  label: string;
  description?: string;
}

interface SearchSelectProps {
  options: SearchSelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
}

export function SearchSelect({ options, value, onValueChange, placeholder = 'Select...', searchPlaceholder = 'Search...', emptyText = 'No results found.', disabled }: SearchSelectProps) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const [triggerWidth, setTriggerWidth] = React.useState<number>(0);

  React.useEffect(() => {
    if (open && triggerRef.current) {
      setTriggerWidth(triggerRef.current.offsetWidth);
    }
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button ref={triggerRef} variant='outline' role='combobox' aria-expanded={open} disabled={disabled} className='w-full justify-between font-normal'>
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected ? `${selected.label}${selected.description ? ` (${selected.description})` : ''}` : placeholder}
          </span>
          <ChevronsUpDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='p-0' align='start' style={{ width: triggerWidth > 0 ? triggerWidth : undefined }}>
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className='max-h-60 overflow-y-auto'>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.description ?? ''}`}
                  onSelect={() => {
                    onValueChange(option.value);
                    setOpen(false);
                  }}
                >
                  <div className={cn('mr-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary', option.value === value ? 'bg-primary text-primary-foreground' : 'opacity-50')}>
                    {option.value === value && <Check className='h-3 w-3' />}
                  </div>
                  <div className='flex flex-col'>
                    <span className='text-sm'>{option.label}</span>
                    {option.description && <span className='text-xs text-muted-foreground'>{option.description}</span>}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}