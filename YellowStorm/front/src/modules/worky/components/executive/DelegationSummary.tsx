import type { JSX } from 'react';
import { Bot, Users } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import type { WorkyDelegationItem } from '../../executive/executiveModel';

export function DelegationSummary({ items }: { items: WorkyDelegationItem[] }): JSX.Element {
  const { t } = useModuleTranslation('worky');
  return (
    <section className='rounded-2xl border border-border/70 bg-card p-5 shadow-sm'>
      <h2 className='mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-foreground'>
        <Users className='size-4 text-primary' />
        {t('executive.delegation.title')}
      </h2>
      {items.length === 0 ? <p className='text-sm text-muted-foreground'>{t('executive.delegation.empty')}</p> : (
        <div className='space-y-3'>
          {items.map((item) => (
            <div key={item.key} className='flex items-center gap-3'>
              <span className='flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground'>
                {item.type === 'human' ? <Users className='size-4' /> : <Bot className='size-4' />}
              </span>
              <span className='min-w-0 flex-1'>
                <span className='block truncate text-sm font-medium'>{item.name}</span>
                <span className='block truncate text-xs text-muted-foreground'>{item.role || t(`executive.delegation.${item.type}`)}</span>
              </span>
              <span className='text-xs text-muted-foreground'>{item.activeCount > 0 ? t('executive.delegation.working') : t('executive.delegation.waiting')}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
