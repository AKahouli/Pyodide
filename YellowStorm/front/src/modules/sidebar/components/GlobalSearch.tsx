import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Folder, MessageSquare, Search } from 'lucide-react';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { SidebarMenuButton } from '@/components/ui/sidebar';
import { useModuleTranslation } from '@/modules/localization';
import { useHistoryConversations } from '@/modules/conversation/store';
import { useConversationV2PointersStore } from '@/modules/conversation-v2/store';
// Leaf imports: the project barrel pulls in ProjectPage's heavy graph, which
// cycles back into this module during evaluation.
import { useProjects } from '@/modules/project/store';
import { buildHistoryRows } from './chatGroups';

export interface SearchDestination {
  label: string;
  to: string;
  icon: React.ReactNode;
}

/** Global ⌘K search palette: chats, projects and navigation destinations, all client-side. */
export function GlobalSearch({
  destinations,
  showChats,
  showProjects,
}: {
  destinations: SearchDestination[];
  showChats: boolean;
  showProjects: boolean;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { t } = useModuleTranslation('sidebar');
  const conversations = useHistoryConversations();
  const pointers = useConversationV2PointersStore((s) => s.items);
  const projects = useProjects();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const rows = useMemo(
    () => buildHistoryRows(conversations, pointers, t('recentChats.untitled')),
    [conversations, pointers, t],
  );

  const go = (to: string) => () => {
    setOpen(false);
    navigate(to);
  };

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

  return (
    <>
      <SidebarMenuButton
        tooltip={t('search.label')}
        onClick={() => setOpen(true)}
        aria-label={t('search.label')}
        className='text-muted-foreground'
      >
        <Search aria-hidden='true' />
        <span className='truncate'>{t('search.label')}</span>
        <kbd className='pointer-events-none ml-auto shrink-0 rounded border border-sidebar-border bg-sidebar-accent px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground group-data-[collapsible=icon]:hidden'>
          {isMac ? '⌘K' : 'Ctrl K'}
        </kbd>
      </SidebarMenuButton>

      <CommandDialog open={open} onOpenChange={setOpen} title={t('search.label')}>
        <CommandInput placeholder={t('search.placeholder')} />
        <CommandList>
          <CommandEmpty>{t('search.empty')}</CommandEmpty>
          {showChats && (
            <CommandGroup heading={t('search.groupChats')}>
              {rows.slice(0, 8).map((row) => (
                <CommandItem key={row.id} value={`${row.title} ${row.id}`} onSelect={go(row.to)}>
                  <MessageSquare aria-hidden='true' className='mr-2 h-4 w-4' />
                  <span className='truncate'>{row.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {showProjects && projects.length > 0 && (
            <CommandGroup heading={t('search.groupProjects')}>
              {projects.slice(0, 5).map((project) => (
                <CommandItem key={project.id} value={`${project.name} ${project.id}`} onSelect={go(`/projet/${project.id}`)}>
                  <Folder aria-hidden='true' className='mr-2 h-4 w-4' />
                  <span className='truncate'>{project.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandGroup heading={t('search.groupGoTo')}>
            {destinations.map((dest) => (
              <CommandItem key={dest.to} value={`${dest.label} ${dest.to}`} onSelect={go(dest.to)}>
                <span aria-hidden='true' className='mr-2 flex size-4 items-center justify-center'>
                  {dest.icon}
                </span>
                {dest.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
