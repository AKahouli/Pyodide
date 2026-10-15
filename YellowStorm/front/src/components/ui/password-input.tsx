import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { useModuleTranslation } from '@/modules/localization';

export type PasswordInputProps = Omit<React.ComponentProps<typeof Input>, 'type'>;

/**
 * Password field with an inline show/hide toggle. Forwards every prop (id,
 * aria-*, event handlers) and the ref to the inner `<Input>`, so it works as a
 * direct child of `<FormControl>` (Radix Slot).
 */
export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { className, disabled, ...props },
  ref,
) {
  const { t } = useModuleTranslation('common');
  const [visible, setVisible] = React.useState(false);

  const toggle = React.useCallback(() => setVisible((current) => !current), []);

  return (
    <div className='relative'>
      <Input ref={ref} type={visible ? 'text' : 'password'} disabled={disabled} className={cn('pr-9', className)} {...props} />
      <button
        type='button'
        onClick={toggle}
        disabled={disabled}
        aria-label={visible ? t('actionHidePassword') : t('actionShowPassword')}
        aria-pressed={visible}
        className='absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'
      >
        {visible ? <EyeOff className='h-4 w-4' aria-hidden='true' /> : <Eye className='h-4 w-4' aria-hidden='true' />}
      </button>
    </div>
  );
});

PasswordInput.displayName = 'PasswordInput';
