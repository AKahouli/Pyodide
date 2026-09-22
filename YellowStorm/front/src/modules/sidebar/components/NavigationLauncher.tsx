import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SidebarMenuButton } from '@/components/ui/sidebar';
import { NAVIGATION_TARGETS, navigationLabel, type NavigationNode, type NavigationSettings } from '@/modules/admin';
import { NAVIGATION_TARGET_ICONS } from './ManagedNavigation';

interface NavigationLauncherProps {
  settings: NavigationSettings;
  items: NavigationNode[];
  language: string;
  mobile: boolean;
  onNewConversation: () => void;
  label: string;
}

export function NavigationLauncher({ settings, items, language, mobile, onNewConversation, label }: NavigationLauncherProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const portalContainer = useRef<HTMLDivElement>(null);
  const byId = new Map(settings.nodes.map((node) => [node.id, node]));
  const sections = new Map<string, { label: string; items: NavigationNode[] }>();

  for (const item of items) {
    let root = item;
    while (root.parentId && byId.has(root.parentId)) root = byId.get(root.parentId)!;
    const key = root.type === 'group' ? root.id : '__root';
    const section = sections.get(key) ?? {
      label: root.type === 'group' ? navigationLabel(root.labels, language) : '',
      items: [],
    };
    section.items.push(item);
    sections.set(key, section);
  }

  const launch = (item: NavigationNode) => {
    setOpen(false);
    if (item.targetKey === 'newChat') onNewConversation();
    else if (item.targetKey) navigate(NAVIGATION_TARGETS[item.targetKey].path);
  };

  return <div ref={portalContainer} className='contents'>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <SidebarMenuButton tooltip={label} className='border border-sidebar-border bg-sidebar-accent/60 font-medium'>
          <Plus /><span>{label}</span>
        </SidebarMenuButton>
      </PopoverTrigger>
      <PopoverContent portalContainer={mobile ? portalContainer.current : undefined} side={mobile ? 'bottom' : 'right'} align='start' sideOffset={8} className='pointer-events-auto max-h-[min(36rem,calc(100vh-2rem))] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto p-3'>
        <div className='mb-3 flex items-center gap-2 border-b pb-3'>
          <span className='flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground'><Plus className='size-4' /></span>
          <h2 className='font-semibold'>{label}</h2>
        </div>
        <div className='space-y-4'>
          {[...sections.entries()].map(([key, section]) => (
            <section key={key}>
              {section.label && <h3 className='mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{section.label}</h3>}
              <div className='grid grid-cols-2 gap-1 sm:grid-cols-3'>
                {section.items.map((item) => {
                  const Icon = NAVIGATION_TARGET_ICONS[item.targetKey!];
                  const itemLabel = navigationLabel(item.labels, language);
                  return <button key={item.id} type='button' className='group flex min-h-20 flex-col items-start justify-between rounded-lg border bg-background p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring' onClick={() => launch(item)}><Icon className='size-5 text-primary transition-transform group-hover:scale-110' /><span className='mt-3 text-sm font-medium leading-tight'>{itemLabel}</span></button>;
                })}
              </div>
            </section>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  </div>;
}
