import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Folder,
  FolderMinus,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';

import Input from '@/components/ai-elements/input';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { Button } from '@/components/ui/button';
import { Input as TextInput } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useModuleTranslation } from '@/modules/localization';
import { useUsage } from '@/modules/usage';
import { useConversationFileUpload } from '@/modules/conversation/hooks/useConversationFileUpload';
import { ACCEPT_EXTENSIONS } from '@/modules/workspace/utils';
import {
  useConversationStore,
  useConversationsByProject,
  useInputDisabled,
  useResetSelectedWorkspaceIds,
} from '@/modules/conversation/store';
import { translateConversation } from '@/modules/conversation/translation';
import { RenameDialog } from '@/modules/conversation/components/RenameDialog';
import { DeleteConversationDialog } from '@/modules/conversation/components/DeleteConversationDialog';
import { useProjects, useProjectStore, RenameProjectDialog, DeleteProjectDialog } from '@/modules/project';
import { formatRelativeTimeLabel } from '@/utils/date';
import type { Conversation } from '@/modules/conversation/types';

export function ProjectPage() {
  const { id: projectId = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useModuleTranslation('sidebar');

  const projects = useProjects();
  const fetchProjects = useProjectStore((s) => s.fetchProjects);
  const projectsInitialized = useProjectStore((s) => s.initialized);
  const renameProject = useProjectStore((s) => s.renameProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const incrementCount = useProjectStore((s) => s.incrementCount);

  const project = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId]);

  useEffect(() => {
    if (projectsInitialized && !project) {
      navigate('/', { replace: true });
    }
  }, [projectsInitialized, project, navigate]);

  const conversations = useConversationsByProject(projectId);
  const fetchProjectConversations = useConversationStore((s) => s.fetchProjectConversations);
  const createConversation = useConversationStore((s) => s.createConversation);
  const sendMessage = useConversationStore((s) => s.sendMessage);
  const inputDisabled = useInputDisabled();
  const resetSelectedWorkspaceIds = useResetSelectedWorkspaceIds();
  const { status: usageStatus } = useUsage();
  const isLimitExceeded = usageStatus?.isLimitExceeded ?? false;

  const [search, setSearch] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [silentConvId, setSilentConvId] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (projects.length === 0) {
      fetchProjects();
    }
    fetchProjectConversations(projectId, { limit: 50 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const createConversationForUpload = useCallback(async () => {
    const conv = await createConversation({ projectId });
    setSilentConvId(conv.id);
    incrementCount(projectId);
    return conv;
  }, [createConversation, incrementCount, projectId]);

  const {
    files: uploadFiles,
    addFiles,
    removeFile,
    completedFileIds,
    isUploading,
    conversationId: resolvedConvId,
    clearAll,
  } = useConversationFileUpload({
    conversationId: silentConvId,
    createConversation: createConversationForUpload,
    onError: (msg) => toast.error(msg),
  });

  const handleSubmit = async (
    message: PromptInputMessage,
    modelId: string,
    agentIds?: string[],
    _memberIds?: string[],
    workspaceIds?: string[],
    connectorRepo?: {
      connectorId: string;
      connectorName: string;
      repoId: string;
      repoName: string;
      repoUrl?: string;
    },
  ) => {
    if (!message.text?.trim() && !completedFileIds.length) return;
    setIsSending(true);
    try {
      let convId = resolvedConvId || silentConvId;
      if (!convId) {
        const conv = await createConversation({
          projectId,
          ...(workspaceIds?.length ? { workspaces: workspaceIds } : {}),
        });
        convId = conv.id;
        incrementCount(projectId);
      }
      navigate(`/conversation/${convId}`);

      const attachedFiles = uploadFiles
        .filter((f) => f.status === 'completed' && f.documentId)
        .map((f) => ({
          id: f.documentId!,
          originalName: f.file.name,
          mimeType: f.file.type,
          size: f.file.size,
          downloadUrl: '',
        }));

      await sendMessage(convId, {
        content: message.text || '',
        attachedFileIds: completedFileIds.length ? completedFileIds : undefined,
        attachedFiles: attachedFiles.length ? attachedFiles : undefined,
        modelId: modelId || undefined,
        agentIds: agentIds?.length ? agentIds : undefined,
        connectorRepo,
      });

      clearAll();
      resetSelectedWorkspaceIds();
    } catch {
      toast.error(translateConversation('toasts.conversation.createError'));
    } finally {
      setIsSending(false);
    }
  };

  const filteredConversations = useMemo(() => {
    const trimmed = search.trim().toLowerCase();
    if (!trimmed) return conversations;
    return conversations.filter((c) => c.title?.toLowerCase().includes(trimmed));
  }, [conversations, search]);

  if (!project) {
    return null;
  }

  return (
    <div className='flex h-full w-full flex-col bg-background'>
      <header className='relative border-b border-border/60 px-6 pb-6 pt-8 sm:px-10 sm:pb-8 sm:pt-10'>
        <div className='mx-auto flex max-w-4xl flex-col gap-4'>
          <NavLink
            to='/'
            className='inline-flex w-fit items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors'
          >
            <ArrowLeft className='h-3.5 w-3.5' />
            {t('projects.backToHome')}
          </NavLink>

          <div className='flex items-end justify-between gap-4'>
            <div className='min-w-0'>
              <div className='mb-3 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground'>
                <Sparkles className='h-3 w-3' />
                {t('actions.projects.label')}
              </div>
              <h1 className='flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl'>
                <span className='flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0'>
                  <Folder className='h-6 w-6' />
                </span>
                <span className='truncate'>{project?.name ?? '…'}</span>
              </h1>
              <p className='mt-2 text-sm text-muted-foreground'>
                {conversations.length === 0
                  ? t('projects.page.emptyHint')
                  : t('projects.page.subtitle', { count: conversations.length })}
              </p>
            </div>

            {project && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant='outline' size='icon' className='h-9 w-9 shrink-0'>
                    <MoreHorizontal className='h-4 w-4' />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                  <DropdownMenuItem className='cursor-pointer' onClick={() => setRenameOpen(true)}>
                    <Pencil className='mr-2 h-4 w-4' />
                    {t('conversations.rename')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className='cursor-pointer text-destructive'
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className='mr-2 h-4 w-4' />
                    {t('conversations.delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </header>

      <div className='flex-1 overflow-y-auto'>
        <div className='mx-auto max-w-4xl px-6 py-8 sm:px-10'>
          <div className='mb-10 rounded-2xl border border-border/60 bg-card/40 p-4 shadow-sm backdrop-blur'>
            <Input
              onSubmit={handleSubmit}
              status={isSending ? 'submitted' : 'ready'}
              disabled={isSending || inputDisabled || isLimitExceeded}
              submitDisabled={isUploading || isSending}
              placeholder={t('projects.page.composerPlaceholder')}
              onFilesAdded={(rawFiles, ids) => addFiles(rawFiles, ids)}
              onFileRemoved={(id) => removeFile(id)}
              uploadingFiles={uploadFiles}
              accept={ACCEPT_EXTENSIONS}
              maxFiles={5}
              showWorkspaceSelect={true}
            />
          </div>

          <div className='mb-4 flex items-center justify-between gap-4'>
            <h2 className='text-sm font-semibold uppercase tracking-wider text-muted-foreground'>
              {t('projects.page.conversationsTitle')}
            </h2>
            {conversations.length > 0 && (
              <div className='relative w-full max-w-xs'>
                <Search className='pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground' />
                <TextInput
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('projects.page.searchPlaceholder')}
                  className='h-8 pl-8 pr-8 text-sm'
                />
                {search && (
                  <button
                    type='button'
                    onClick={() => setSearch('')}
                    className='absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground'
                  >
                    <X className='h-3.5 w-3.5' />
                  </button>
                )}
              </div>
            )}
          </div>

          {conversations.length === 0 ? (
            <div className='flex flex-col items-center justify-center rounded-xl border border-dashed border-border/60 px-6 py-16 text-center'>
              <div className='mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted'>
                <MessageSquare className='h-6 w-6 text-muted-foreground' />
              </div>
              <h3 className='text-base font-medium'>{t('projects.page.emptyTitle')}</h3>
              <p className='mt-1 max-w-sm text-sm text-muted-foreground'>{t('projects.page.emptyHint')}</p>
            </div>
          ) : filteredConversations.length === 0 ? (
            <p className='py-8 text-center text-sm text-muted-foreground'>{t('projects.page.noResults')}</p>
          ) : (
            <div className='grid gap-3 sm:grid-cols-2'>
              {filteredConversations.map((conv) => (
                <ConversationCard key={conv.id} conversation={conv} projectId={projectId} />
              ))}
            </div>
          )}
        </div>
      </div>

      <RenameProjectDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        currentName={project.name}
        onRename={(name) => renameProject(project.id, name)}
      />
      <DeleteProjectDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        name={project.name}
        onConfirm={() => deleteProject(project.id)}
      />
    </div>
  );
}

function ConversationCard({ conversation, projectId }: { conversation: Conversation; projectId: string }) {
  const { t } = useModuleTranslation('sidebar');
  const navigate = useNavigate();
  const moveConversationToProject = useConversationStore((s) => s.moveConversationToProject);
  const deleteConversation = useConversationStore((s) => s.deleteConversation);
  const updateConversation = useConversationStore((s) => s.updateConversation);

  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleRename = useCallback(
    async (newTitle: string) => {
      await updateConversation(conversation.id, { title: newTitle });
    },
    [conversation.id, updateConversation],
  );

  const handleDelete = useCallback(async () => {
    await deleteConversation(conversation.id);
  }, [conversation.id, deleteConversation]);

  const handleRemoveFromProject = useCallback(async () => {
    await moveConversationToProject(conversation.id, null);
  }, [conversation.id, moveConversationToProject]);

  const lastActivity = formatRelativeTimeLabel(conversation.lastMessageAt ?? null, '');

  return (
    <>
      <div className='group relative rounded-xl border border-border/60 bg-card/60 transition-all hover:border-primary/40 hover:bg-card hover:shadow-md focus-within:ring-2 focus-within:ring-ring'>
        <button
          type='button'
          onClick={() => navigate(`/conversation/${conversation.id}`)}
          className='flex w-full flex-col gap-2 p-4 text-left focus:outline-none'
        >
          <div className='flex items-center gap-2 min-w-0 pr-8'>
            <MessageSquare className='h-4 w-4 shrink-0 text-muted-foreground' />
            <span className='truncate text-sm font-medium'>{conversation.title}</span>
          </div>
          <div className='flex items-center justify-between text-xs text-muted-foreground'>
            <span>{t('projects.page.messageCount', { count: conversation.messageCount })}</span>
            {lastActivity && <span>{lastActivity}</span>}
          </div>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              onClick={(e) => e.stopPropagation()}
              className='absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100'
            >
              <MoreHorizontal className='h-4 w-4' />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem className='cursor-pointer' onClick={() => setRenameOpen(true)}>
              <Pencil className='mr-2 h-4 w-4' />
              {t('conversations.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem className='cursor-pointer' onClick={handleRemoveFromProject}>
              <FolderMinus className='mr-2 h-4 w-4' />
              {t('conversations.removeFromProject')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className='cursor-pointer text-destructive'
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className='mr-2 h-4 w-4' />
              {t('conversations.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <RenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        currentTitle={conversation.title}
        onRename={handleRename}
      />
      <DeleteConversationDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={conversation.title}
        onConfirm={handleDelete}
      />
    </>
  );
}
