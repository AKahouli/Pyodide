import { useContext } from 'react';
import { AppLogo as BuiltinAppLogo } from '@/components/icons';
import { ThemeProviderContext } from '@/contexts/ThemeContext';
import { cn } from '@/lib/utils';

type AppBrandLogoProps = Readonly<React.HTMLAttributes<SVGElement>>;

export function AppBrandLogo({ className, style, ...props }: AppBrandLogoProps) {
  const { logo } = useContext(ThemeProviderContext);

  if (logo.url) {
    return <img src={logo.url} alt='' className={cn('h-12 w-56 object-contain', className)} style={style} />;
  }

  return <BuiltinAppLogo className={className} style={style} {...props} />;
}
