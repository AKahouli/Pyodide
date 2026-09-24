import type { JSX } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import type { AttentionPreferences } from '../attentionPreferences';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export function AttentionSettingsButton({ value, onChange, count }: { value: AttentionPreferences; onChange: (value: AttentionPreferences) => void; count: number }): JSX.Element {
  const { t } = useModuleTranslation('worky');
  return <DropdownMenu>
    <DropdownMenuTrigger aria-label={t('command.alerts.title')} title={t('command.alerts.title')} className='relative flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary'>
      {value.sound ? <Bell className='size-4' /> : <BellOff className='size-4' />}
      {count > 0 && <span className='absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-black'>{count}</span>}
    </DropdownMenuTrigger>
    <DropdownMenuContent align='end' className='w-56'>
      <DropdownMenuLabel>{t('command.alerts.title')}</DropdownMenuLabel>
      <DropdownMenuCheckboxItem checked={value.sound} onCheckedChange={(sound) => onChange({ ...value, sound: Boolean(sound) })}>{t('command.alerts.sound')}</DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem checked={value.focus} onCheckedChange={(focus) => onChange({ ...value, focus: Boolean(focus) })}>{t('command.alerts.focus')}</DropdownMenuCheckboxItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
