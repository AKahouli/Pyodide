import * as React from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface MultiSelectOption {
  value: string;
  label: string;
  description?: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onValueChange: (value: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
}

export function MultiSelect({ options, value, onValueChange, placeholder = 'Select...', searchPlaceholder = 'Search...', emptyText = 'No results found.' }: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const [triggerWidth, setTriggerWidth] = React.useState<number>(0);

  React.useEffect(() => {
    if (open && triggerRef.current) {
      setTriggerWidth(triggerRef.current.offsetWidth);
    }
  }, [open]);

  const selectedLabels = value.map((v) => options.find((o) => o.value === v)).filter(Boolean) as MultiSelectOption[];

  const toggle = (optionValue: string) => {
    onValueChange(value.includes(optionValue) ? value.filter((v) => v !== optionValue) : [...value, optionValue]);
  };

  const remove = (optionValue: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onValueChange(value.filter((v) => v !== optionValue));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button ref={triggerRef} variant='outline' role='combobox' aria-expanded={open} className='w-full justify-between h-auto min-h-9 font-normal'>
          <div className='flex flex-wrap gap-1 flex-1 text-left'>
            {selectedLabels.length > 0 ? (
              selectedLabels.map((option) => (
                <Badge key={option.value} variant='secondary' className='text-xs font-normal'>
                  {option.label}
                  <span
                    role='button'
                    tabIndex={0}
                    className='ml-1 rounded-full outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2 hover:bg-muted-foreground/20'
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => remove(option.value, e)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        remove(option.value, e as unknown as React.MouseEvent);
                      }
                    }}>
                    <X className='h-3 w-3' />
                  </span>
                </Badge>
              ))
            ) : (
              <span className='text-muted-foreground'>{placeholder}</span>
            )}
          </div>
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
                <CommandItem key={option.value} value={option.label} onSelect={() => toggle(option.value)}>
                  <div className={cn('mr-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary', value.includes(option.value) ? 'bg-primary text-primary-foreground' : 'opacity-50')}>{value.includes(option.value) && <Check className='h-3 w-3' />}</div>
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
