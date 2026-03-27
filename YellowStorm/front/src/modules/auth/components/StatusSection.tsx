import type { ReactNode } from 'react';
import { CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

type StatusSectionProps = Readonly<{
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}>;

export function StatusSection({ icon, title, description, children }: StatusSectionProps) {
  return (
    <>
      <CardHeader className='text-center'>
        {icon && <div className='mx-auto mb-4'>{icon}</div>}
        <CardTitle className='text-2xl text-white'>{title}</CardTitle>
        {description && <CardDescription className='text-neutral-400'>{description}</CardDescription>}
      </CardHeader>
      {children}
    </>
  );
}
