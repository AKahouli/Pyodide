import { useContext } from 'react';
import { Icons } from '@/components/icons';
import { ThemeProviderContext } from '@/contexts/ThemeContext';
import { cn } from '@/lib/utils';
import { appearanceLogoSrc } from './utils/logo-url';
import type { AppearanceLogo } from '../types';

interface LogoMarkProps {
  logo: AppearanceLogo;
  className?: string;
}

export function LogoMark({ logo, className }: LogoMarkProps) {
  const { theme } = useContext(ThemeProviderContext);
  const customSrc = appearanceLogoSrc(logo);

  if (customSrc) {
    return (
      <img
        src={customSrc}
        alt={logo.name}
        className={cn('h-8 w-full max-w-56 object-contain', className)}
      />
    );
  }
  if (logo.id === 'kpmg') {
    return <Icons.Kpmg className={cn('h-7 w-auto', className)} style={{ color: theme === 'light' ? '#2563eb' : '#ffffff' }} />;
  }
  return <Icons.YellowMind className={cn('h-7 w-auto max-w-44', className)} />;
}
