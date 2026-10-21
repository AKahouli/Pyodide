import * as React from 'react';
import { Check, ChevronsUpDown, Info, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

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
  /** Opt in to descriptions on the Command-highlighted option, not DOM focus. */
  optionTooltips?: boolean;
  controlTooltip?: string;
  searchTooltip?: string;
  removeTooltip?: (option: MultiSelectOption) => string;
}

function MultiSelectHelp({ description, children, suppressed = false }: { description: string; children: React.ReactElement; suppressed?: boolean }) {
  const [open, setOpen] = React.useState(false);
  return <Tooltip open={open && !suppressed} onOpenChange={setOpen}><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent className='max-w-xs whitespace-normal'>{description}</TooltipContent></Tooltip>;
}

export function MultiSelect({ options, value, onValueChange, placeholder = 'Select...', searchPlaceholder = 'Search...', emptyText = 'No results found.', optionTooltips = false, controlTooltip, searchTooltip, removeTooltip }: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState('');
  const [optionHelpDismissed, setOptionHelpDismissed] = React.useState(false);
  const [searchHelpActive, setSearchHelpActive] = React.useState(false);
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

  const withHelp = (description: string | undefined, child: React.ReactElement, suppressed = false) => description ? <MultiSelectHelp description={description} suppressed={suppressed}>{child}</MultiSelectHelp> : child;

  return (
    <TooltipProvider delayDuration={200}>
    <Popover open={open} onOpenChange={setOpen}>
      {withHelp(controlTooltip, <PopoverTrigger asChild>
        <Button ref={triggerRef} variant='outline' role='combobox' aria-label={controlTooltip} aria-description={controlTooltip} aria-expanded={open} className='w-full justify-between h-auto min-h-9 font-normal'>
          <div className='flex flex-wrap gap-1 flex-1 text-start'>
            {selectedLabels.length > 0 ? (
              selectedLabels.map((option) => (
                <Badge key={option.value} variant='secondary' className='text-xs font-normal'>
                  {option.label}
                  {withHelp(removeTooltip?.(option), <span
                    aria-label={removeTooltip?.(option)}
                    role='button'
                    tabIndex={0}
                    className='ms-1 rounded-full outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2 hover:bg-muted-foreground/20'
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => remove(option.value, e)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        remove(option.value, e as unknown as React.MouseEvent);
                      }
                    }}>
                    <X className='h-3 w-3' />
                  </span>)}
                </Badge>
              ))
            ) : (
              <span className='text-muted-foreground'>{placeholder}</span>
            )}
          </div>
          <ChevronsUpDown className='ms-2 h-4 w-4 shrink-0 opacity-50' />
        </Button>
      </PopoverTrigger>, open)}
      <PopoverContent className='p-0' align='start' style={{ width: triggerWidth > 0 ? triggerWidth : undefined }}>
        <Command value={optionTooltips ? highlighted : undefined} onValueChange={optionTooltips ? (next) => { setHighlighted(next); setOptionHelpDismissed(false); } : undefined}>
          {searchTooltip ? <div className='flex items-center'><div className='min-w-0 flex-1'><CommandInput aria-label={searchPlaceholder} aria-description={searchTooltip} placeholder={searchPlaceholder} /></div>{withHelp(searchTooltip, <button type='button' aria-label={searchTooltip} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }} onFocus={() => setSearchHelpActive(true)} onBlur={() => setSearchHelpActive(false)} onPointerEnter={() => setSearchHelpActive(true)} onPointerLeave={(event) => setSearchHelpActive(event.currentTarget === document.activeElement)} className='mx-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'><Info aria-hidden='true' className='h-3.5 w-3.5' /></button>)}</div> : <CommandInput aria-label={searchPlaceholder} placeholder={searchPlaceholder} />}
          <CommandList className='max-h-60 overflow-y-auto'>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const item = <CommandItem key={option.value} value={optionTooltips ? option.value : option.label} keywords={optionTooltips ? [option.label] : undefined} onPointerMove={optionTooltips ? () => { setHighlighted(option.value); setOptionHelpDismissed(false); } : undefined} onSelect={() => toggle(option.value)}>
                  <div className={cn('me-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary', value.includes(option.value) ? 'bg-primary text-primary-foreground' : 'opacity-50')}>{value.includes(option.value) && <Check className='h-3 w-3' />}</div>
                  <div className='flex flex-col'>
                    <span className='text-sm'>{option.label}</span>
                    {!optionTooltips && option.description && <span className='text-xs text-muted-foreground'>{option.description}</span>}
                  </div>
                </CommandItem>;
                return optionTooltips && option.description ? <Tooltip key={option.value} open={open && highlighted === option.value && !optionHelpDismissed && !searchHelpActive}><TooltipTrigger asChild>{item}</TooltipTrigger><TooltipContent onEscapeKeyDown={() => setOptionHelpDismissed(true)} side='right' className='max-w-xs whitespace-normal'>{option.description}</TooltipContent></Tooltip> : item;
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    </TooltipProvider>
  );
}
