import { Check, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { useSemanticModels } from '@/modules/semantic-model/query/hooks';

interface SemanticModelSelectProps {
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  label?: string;
}

export function SemanticModelSelect({ value, onChange, disabled, label }: SemanticModelSelectProps) {
  const { t } = useModuleTranslation('conversation');
  const published = useSemanticModels({ status: 'published', limit: 100 });
  const drafts = useSemanticModels({ status: 'draft', limit: 100 });
  const models = [...(published.data?.items ?? []), ...(drafts.data?.items ?? [])]
    .filter((model, index, items) => items.findIndex((item) => item.id === model.id) === index);
  const isLoading = published.isLoading || drafts.isLoading;
  const selected = models.find((model) => model.id === value);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant={value ? 'secondary' : 'ghost'}
          size='icon'
          className={label ? 'h-11 w-auto gap-2 px-3' : 'size-11 md:size-8'}
          disabled={disabled}
          aria-label={`${label ? `${label}: ` : ''}${selected ? t('input.semanticModel.selected', { name: selected.name }) : t('input.semanticModel.select')}`}
          title={selected?.name ?? t('input.semanticModel.select')}
        >
          <Network className='size-4' />
          {label && <span>{label}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-80 p-0' align='start'>
        <Command>
          <CommandInput placeholder={t('input.semanticModel.search')} />
          <CommandList>
            <CommandEmpty>{isLoading ? t('input.semanticModel.loading') : t('input.semanticModel.empty')}</CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem onSelect={() => onChange(null)}>
                  <span>{t('input.semanticModel.none')}</span>
                </CommandItem>
              )}
              {models.map((model) => (
                <CommandItem key={model.id} value={model.name} disabled={model.indexStatus !== 'indexed'} onSelect={() => onChange(model.id)}>
                  <Network className='mr-2 size-4 shrink-0' />
                  <span className='min-w-0 flex-1 truncate'>{model.name}</span>
                  <span role='status' aria-label={model.indexStatus} className={`mr-1 h-2 w-2 rounded-full ${model.indexStatus === 'indexed' ? 'bg-emerald-500' : model.indexStatus === 'failed' ? 'bg-red-500' : `bg-amber-500 ${model.indexStatus === 'pending' || model.indexStatus === 'in_progress' ? 'animate-pulse' : ''}`}`} />
                  <Check className={cn('ml-2 size-4', value === model.id ? 'opacity-100' : 'opacity-0')} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
