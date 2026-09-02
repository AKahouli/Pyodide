import { useContext } from 'react';
import { AppLogo as BuiltinAppLogo } from '@/components/icons';
import { ThemeProviderContext } from '@/contexts/ThemeContext';
import { cn } from '@/lib/utils';

type AppBrandLogoProps = Readonly<{
  className?: string;
  style?: React.CSSProperties;
}>;

function logoAlt(id: string, name?: string): string {
  if (name?.trim()) {
    return name.trim();
  }
  if (id === 'kpmg') {
    return 'KPMG';
  }
  return 'Yellowmind';
}

export function AppBrandLogo({ className, style }: AppBrandLogoProps) {
  const { logo } = useContext(ThemeProviderContext);

  if (logo.url) {
    return <img src={logo.url} alt={logoAlt(logo.id, logo.name)} className={cn('h-12 w-56 object-contain', className)} style={style} />;
  }

  return <BuiltinAppLogo className={className} style={style} />;
}
