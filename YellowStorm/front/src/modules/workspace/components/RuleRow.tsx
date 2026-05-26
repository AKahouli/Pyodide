import { useState } from 'react';
import { Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import type { ClassifierRule } from '../types';

type Props = {
  rule: ClassifierRule;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
  showScopeBadge?: boolean;
};

export function RuleRow({ rule, onToggle, onDelete, showScopeBadge }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className={cn('group flex items-start gap-3 rounded-md border bg-card p-3 transition-colors', !rule.enabled && 'opacity-60')}>
      <Switch
        checked={rule.enabled}
        onCheckedChange={onToggle}
        className='mt-0.5'
        aria-label={rule.enabled ? 'Désactiver la règle' : 'Réactiver la règle'}
      />
      <div className='flex-1 space-y-1'>
        {showScopeBadge && (
          <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', rule.scope === 'global' ? 'bg-primary/10 text-primary' : 'bg-secondary text-secondary-foreground')}>
            {rule.scope === 'global' ? 'Global' : 'Local'}
          </span>
        )}
        <p className={cn('whitespace-pre-wrap text-sm leading-relaxed', !rule.enabled && 'line-through')}>{rule.text}</p>
      </div>
      {confirmDelete ? (
        <div className='flex items-center gap-1'>
          <Button size='sm' variant='destructive' onClick={onDelete} className='h-7 px-2 text-xs'>
            Supprimer
          </Button>
          <Button size='sm' variant='ghost' onClick={() => setConfirmDelete(false)} className='h-7 w-7 p-0'>
            <X className='h-3.5 w-3.5' />
          </Button>
        </div>
      ) : (
        <Button
          size='sm'
          variant='ghost'
          onClick={() => setConfirmDelete(true)}
          className='h-7 w-7 shrink-0 p-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive'
        >
          <Trash2 className='h-4 w-4' />
        </Button>
      )}
    </div>
  );
}
