import * as React from 'react';
import { cn } from '@/lib/utils';

export function Button({
  className,
  type = 'button',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
