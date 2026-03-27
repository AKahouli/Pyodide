import { useContext } from 'react';
import { AlertTriangleIcon, CheckIcon, InfoIcon, Loader2Icon, AlertOctagon } from 'lucide-react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { ThemeProviderContext } from '@/contexts/ThemeContext';

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useContext(ThemeProviderContext);

  // Resolve actual theme for sonner (handle "system" setting)
  const resolvedTheme = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;

  return (
    <Sonner
      theme={resolvedTheme as ToasterProps['theme']}
      className='toaster group'
      icons={{
        success: <CheckIcon className='size-4' />,
        info: <InfoIcon className='size-4' />,
        warning: <AlertTriangleIcon className='size-4' />,
        error: <AlertOctagon className='size-4' />,
        loading: <Loader2Icon className='size-4 animate-spin' />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
