import { useContext } from 'react';
import { Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import { ThemeProviderContext } from '@/contexts/ThemeContext';
import { useModuleTranslation } from '@/modules/localization';

export function ModeToggle() {
  const { setTheme } = useContext(ThemeProviderContext);
  const { t } = useModuleTranslation('common');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' className='w-9 px-0'>
          <Sun className='h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0' />
          <Moon className='absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100' />
          <span className='sr-only'>{t('modeToggle.toggle')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuItem className='cursor-pointer' onClick={() => setTheme('light')}>
          {t('modeToggle.light')}
        </DropdownMenuItem>
        <DropdownMenuItem className='cursor-pointer' onClick={() => setTheme('dark')}>
          {t('modeToggle.dark')}
        </DropdownMenuItem>
        <DropdownMenuItem className='cursor-pointer' onClick={() => setTheme('system')}>
          {t('modeToggle.system')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
