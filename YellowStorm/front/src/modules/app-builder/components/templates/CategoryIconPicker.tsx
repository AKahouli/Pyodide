import { useState } from 'react';
import { ChevronsUpDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { CATEGORY_ICON_GROUPS, CategoryIcon } from './category-icons';

interface CategoryIconPickerProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
}

export function CategoryIconPicker({ value, onChange, disabled, id }: CategoryIconPickerProps) {
  const { t } = useModuleTranslation('app-builder');
  const [open, setOpen] = useState(false);

  const select = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type='button'
          variant='outline'
          role='combobox'
          aria-expanded={open}
          disabled={disabled}
          className='h-10 w-full justify-between font-normal'
        >
          <span className={cn('flex min-w-0 items-center gap-2', !value && 'text-muted-foreground')}>
            {value ? (
              <>
                <span className='flex size-6 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary'>
                  <CategoryIcon name={value} className='size-3.5' />
                </span>
                <span className='truncate'>{value}</span>
              </>
            ) : (
              t('categories.selectIcon')
            )}
          </span>
          <ChevronsUpDown className='ms-2 size-4 shrink-0 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-[var(--radix-popover-trigger-width)] p-0'>
        <div className='max-h-72 overflow-y-auto p-2'>
          <button
            type='button'
            onClick={() => select('')}
            className={cn(
              'mb-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              !value ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            <X className='size-4' aria-hidden />
            {t('categories.noIcon')}
          </button>

          <div className='space-y-3'>
            {CATEGORY_ICON_GROUPS.map((group) => {
              const label = t(`categories.iconGroups.${group.key}`);
              return (
                <div key={group.key}>
                  <p className='mb-1.5 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground'>{label}</p>
                  <div role='radiogroup' aria-label={label} className='grid grid-cols-8 gap-1'>
                    {group.icons.map((iconName) => {
                      const selected = value === iconName;
                      return (
                        <button
                          key={iconName}
                          type='button'
                          role='radio'
                          aria-checked={selected}
                          aria-label={iconName}
                          title={iconName}
                          disabled={disabled}
                          onClick={() => select(iconName)}
                          className={cn(
                            'flex aspect-square items-center justify-center rounded-lg border transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                            selected
                              ? 'border-primary bg-primary/15 text-primary shadow-sm'
                              : 'border-transparent text-muted-foreground hover:border-border/70 hover:bg-background hover:text-foreground',
                          )}
                        >
                          <CategoryIcon name={iconName} className='size-4' />
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
