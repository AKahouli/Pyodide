import { useState, type ReactNode } from 'react';

/** Native disclosure retains child state after its first expansion. */
export function WorkDisclosure({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  const [opened, setOpened] = useState(false);
  return <details className={className} onToggle={(event) => {
    if (event.currentTarget.open) setOpened(true);
  }}>
    <summary className='cursor-pointer py-2 text-xs text-muted-foreground'>{label}</summary>
    {opened && children}
  </details>;
}
