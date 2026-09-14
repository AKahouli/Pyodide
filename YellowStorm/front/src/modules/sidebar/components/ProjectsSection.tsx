import { memo, useCallback, useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ChevronDown,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Trash2,
  ChevronRight,
  Users,
} from 'lucide-react';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuAction,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useModuleTranslation } from '@/modules/localization';
import { useAuth } from '@/modules/auth';
import { isPendingAdminApproval } from '@/modules/auth/utils/isPendingAdminApproval';
import {
  useProjects,
  useSharedProjects,
  useProjectStore,
  CreateProjectDialog,
  RenameProjectDialog,
  DeleteProjectDialog,
} from '@/modules/project';
import type { Project } from '@/modules/project';
import { useConversationStore } from '@/modules/conversation/store';
import { decodeConversationDrag, hasConversationDrag } from './drag-types';

const MAX_VISIBLE_PROJECTS = 5;

interface ProjectRowProps {
  project: Project;
  onRename: () => void;
  onDelete: () => void;
  insideMore?: boolean;
}

const ProjectRow = memo(function ProjectRow({ project, onRename, onDelete, insideMore }: ProjectRowProps) {
  const { t } = useModuleTranslation('sidebar');
  const moveConversationToProject = useConversationStore((s) => s.moveConversationToProject);
  const [isOver, setIsOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!hasConversationDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      setIsOver(false);
      const payload = decodeConversationDrag(
        e.dataTransfer.getData('application/x-yellowstorm-conversation'),
      );
      if (!payload) return;
      e.preventDefault();
      if (payload.sourceProjectId === project.id) return;
      try {
        await moveConversationToProject(payload.conversationId, project.id);
        toast.success(t('projects.toasts.conversationMoved'));
      } catch {
        // store handles error toast
      }
    },
    [moveConversationToProject, project.id, t],
  );

  if (insideMore) {
    return (
      <div
        className={cn(
          'group/proj flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent',
          isOver && 'ring-1 ring-primary/40 bg-primary/5',
        )}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <NavLink
          to={`/projet/${project.id}`}
          draggable={false}
          className='flex flex-1 items-center gap-2 min-w-0'
        >
          <Folder className='h-4 w-4 shrink-0 text-muted-foreground' />
          <span className='truncate'>{project.name}</span>
        </NavLink>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              onPointerDown={(e) => e.stopPropagation()}
              className='opacity-0 group-hover/proj:opacity-100 rounded p-0.5 hover:bg-muted'
            >
              <MoreHorizontal className='h-4 w-4' />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side='right' align='start'>
            <DropdownMenuItem onClick={onRename} className='cursor-pointer'>
              <Pencil className='mr-2 h-4 w-4' />
              {t('conversations.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDelete} className='cursor-pointer text-destructive'>
              <Trash2 className='mr-2 h-4 w-4' />
              {t('conversations.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  return (
    <li
      data-slot='sidebar-menu-item'
      data-sidebar='menu-item'
      className={cn(
        'group/menu-item relative',
        isOver && 'rounded-md ring-1 ring-primary/40 bg-primary/5',
      )}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <SidebarMenuButton asChild tooltip={project.name}>
        <NavLink to={`/projet/${project.id}`} draggable={false}>
          <Folder className='h-4 w-4' />
          <span className='truncate'>{project.name}</span>
        </NavLink>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover draggable={false} aria-label={t('projects.actions', { name: project.name })}>
            <MoreHorizontal />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side='right' align='start'>
          <DropdownMenuItem onClick={onRename} className='cursor-pointer'>
            <Pencil className='mr-2 h-4 w-4' />
            {t('conversations.rename')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDelete} className='cursor-pointer text-destructive'>
            <Trash2 className='mr-2 h-4 w-4' />
            {t('conversations.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
});

export const ProjectsSection = memo(function ProjectsSection({ label }: { label?: string }) {
  const { t } = useModuleTranslation('sidebar');
  const { user } = useAuth();
  const pendingApproval = isPendingAdminApproval(user);
  const projects = useProjects();
  const sharedProjects = useSharedProjects();
  const fetchProjects = useProjectStore((s) => s.fetchProjects);
  const fetchSharedProjects = useProjectStore((s) => s.fetchSharedProjects);
  const createProject = useProjectStore((s) => s.createProject);
  const renameProject = useProjectStore((s) => s.renameProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const navigate = useNavigate();

  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('projects:sectionOpen') === 'true';
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  useEffect(() => {
    if (pendingApproval) return;
    fetchProjects();
    fetchSharedProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingApproval]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('projects:sectionOpen', String(open));
    }
  }, [open]);

  const handleCreate = useCallback(
    async (name: string) => {
      const project = await createProject(name);
      navigate(`/projet/${project.id}`);
    },
    [createProject, navigate],
  );

  const handleRename = useCallback(
    async (name: string) => {
      if (!renameTarget) return;
      await renameProject(renameTarget.id, name);
    },
    [renameProject, renameTarget],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    await deleteProject(deleteTarget.id);
  }, [deleteProject, deleteTarget]);

  const visibleProjects = projects.slice(0, MAX_VISIBLE_PROJECTS);
  const remainingProjects = projects.slice(MAX_VISIBLE_PROJECTS);

  return (
    <>
      <Collapsible open={open} onOpenChange={setOpen}>
        <SidebarMenu>
          <SidebarMenuItem>
            <CollapsibleTrigger asChild>
              <SidebarMenuButton tooltip={label ?? t('actions.projects.label')}>
                <Folder />
                <span>{label ?? t('actions.projects.label')}</span>
                <ChevronDown
                  className={`ml-auto h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`}
                />
              </SidebarMenuButton>
            </CollapsibleTrigger>
          </SidebarMenuItem>
        </SidebarMenu>
        <CollapsibleContent>
          <SidebarMenu className='pl-3'>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip={t('projects.create.title')}
                onClick={() => setCreateOpen(true)}
                className='text-muted-foreground hover:text-foreground'
              >
                <FolderPlus className='h-4 w-4' />
                <span>{t('conversations.newProject')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {visibleProjects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                onRename={() => setRenameTarget(project)}
                onDelete={() => setDeleteTarget(project)}
              />
            ))}

            {remainingProjects.length > 0 && (
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton
                      tooltip={t('projects.more')}
                      className='text-muted-foreground hover:text-foreground'
                    >
                      <MoreHorizontal className='h-4 w-4' />
                      <span>{t('projects.more')}</span>
                      <ChevronRight className='ml-auto h-4 w-4' />
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    side='right'
                    align='start'
                    className='min-w-[220px] max-h-[60vh] overflow-y-auto p-1'
                  >
                    {remainingProjects.map((project) => (
                      <ProjectRow
                        key={project.id}
                        project={project}
                        onRename={() => setRenameTarget(project)}
                        onDelete={() => setDeleteTarget(project)}
                        insideMore
                      />
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            )}

            {sharedProjects.length > 0 && (
              <SidebarMenuItem className='pt-2'>
                <span className='flex items-center gap-1.5 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
                  <Users className='h-3 w-3' />
                  {t('projects.sharedWithMe')}
                </span>
              </SidebarMenuItem>
            )}
            {sharedProjects.map((project) => (
              <SidebarMenuItem key={`shared-${project.id}`}>
                <SidebarMenuButton asChild tooltip={`${project.name} · ${project.owner.email}`}>
                  <NavLink to={`/projet/${project.id}`} draggable={false}>
                    <Folder className='h-4 w-4' />
                    <span className='truncate'>{project.name}</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </CollapsibleContent>
      </Collapsible>

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={handleCreate} />
      {renameTarget && (
        <RenameProjectDialog
          open={!!renameTarget}
          onOpenChange={(o) => !o && setRenameTarget(null)}
          currentName={renameTarget.name}
          onRename={handleRename}
        />
      )}
      {deleteTarget && (
        <DeleteProjectDialog
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          name={deleteTarget.name}
          onConfirm={handleDelete}
        />
      )}
    </>
  );
});
