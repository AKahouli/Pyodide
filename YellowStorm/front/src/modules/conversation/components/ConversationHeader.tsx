import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ArrowLeft, FileDown, FileText, Loader2, Pencil, Share, ShieldCheck, Trash2, Users } from 'lucide-react';
import { useConversationStore, useCurrentConversation } from '../store';
import { useTypewriter } from '../hooks/useTypewriter';
import { fetchMessages } from '../api';
import { buildExportBlocks, buildExportFilename, fetchAllMessagesForExport, type ExportBlock } from '../utils/document-export';
import { downloadBlob, exportBlocksToDocx } from '../utils/docx-export';
import { showError, showInfo, showSuccess } from '@/lib/notifications';
import { RenameDialog } from './RenameDialog';
import { DeleteConversationDialog } from './DeleteConversationDialog';
import { ShareDialog } from './ShareDialog';
import { ConversationPdfExport } from './ConversationPdfExport';
import { CreateGroupConversationDialog } from './CreateGroupConversationDialog';
import { useModuleTranslation } from '@/modules/localization';

export function ConversationHeader() {
  const navigate = useNavigate();
  const conversation = useCurrentConversation();
  const updateConversation = useConversationStore((s) => s.updateConversation);
  const deleteConversation = useConversationStore((s) => s.deleteConversation);
  const typewriterConversationId = useConversationStore((s) => s.typewriterConversationId);
  const typewriterName = useConversationStore((s) => s.typewriterName);
  const clearTypewriter = useConversationStore((s) => s.clearTypewriter);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [isExportingDocx, setIsExportingDocx] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [pdfBlocks, setPdfBlocks] = useState<ExportBlock[] | null>(null);
  const { t, language } = useModuleTranslation('conversation');

  // Typewriter effect for newly generated names
  const isTypewriting = typewriterConversationId === conversation?.id;
  const typewriterText = useTypewriter(isTypewriting ? typewriterName : null, 30, clearTypewriter);

  if (!conversation) return null;

  const displayTitle = isTypewriting && typewriterText ? typewriterText : conversation.title;
  const isGoverned = conversation.runtimeMode === 'governed';

  const handleShare = () => {
    setShareOpen(true);
  };

  const exportTitle = conversation?.title?.trim() || t('exportPdf.untitledConversation');

  const buildExportBlocksForConversation = async (): Promise<ExportBlock[]> => {
    const messages = await fetchAllMessagesForExport(conversation.id, (id, params) => fetchMessages(id, params));
    const formatTimestamp = (iso: string) => {
      const date = new Date(iso);
      return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
    };
    return buildExportBlocks(messages, { user: t('export.userLabel'), assistant: t('export.assistantLabel') }, formatTimestamp);
  };

  const handleExportDocx = async () => {
    if (isExportingDocx) return;
    setIsExportingDocx(true);
    try {
      const blocks = await buildExportBlocksForConversation();
      if (!blocks.length) {
        showInfo(t('export.empty'));
        return;
      }
      const blob = await exportBlocksToDocx(blocks, exportTitle);
      downloadBlob(blob, buildExportFilename(exportTitle, 'docx'));
      showSuccess(t('toasts.export.docxSuccess'));
    } catch {
      showError(t('toasts.export.failed'));
    } finally {
      setIsExportingDocx(false);
    }
  };

  const handleExportPdf = async () => {
    if (isExportingPdf || pdfBlocks) return;
    setIsExportingPdf(true);
    try {
      const blocks = await buildExportBlocksForConversation();
      if (!blocks.length) {
        showInfo(t('export.empty'));
        return;
      }
      setPdfBlocks(blocks);
    } catch {
      showError(t('toasts.message.exportError'));
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleRename = async (newTitle: string) => {
    await updateConversation(conversation.id, { title: newTitle });
  };

  const handleDelete = async () => {
    await deleteConversation(conversation.id);
    navigate('/');
  };

  return (
    <>
      <div className='sticky top-0 z-10 flex items-center gap-2 border-b border-border/50 bg-background/85 px-3 py-3 backdrop-blur-sm md:px-4'>
        <Button variant='ghost' size='icon' onClick={() => navigate('/')} className='size-11 shrink-0 md:size-9' aria-label={t('header.actions.back')}>
          <ArrowLeft className='h-4 w-4' />
        </Button>
        <div className='flex min-w-0 flex-1 items-center gap-1'>
          <h1 className='flex min-w-0 items-center font-medium text-lg'>
            <span className='truncate'>{displayTitle}</span>
          </h1>
          {isGoverned && conversation.governanceContext && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} data-governed-badge aria-label={t('governedConversation.description')} className='inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'>
                    <ShieldCheck className='size-3.5' aria-hidden='true' />
                    {t('governedConversation.badge')}
                  </span>
                </TooltipTrigger>
                <TooltipContent className='max-w-72'>
                  <div className='grid gap-0.5'>
                    <p className='font-semibold'>{t('governedConversation.title')}</p>
                    <p>{t('governedConversation.version', { number: conversation.governanceContext.revisionNumber })}</p>
                    <p className='text-muted-foreground'>{t('governedConversation.description')}</p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant='ghost' size='icon' onClick={() => setRenameOpen(true)} className='size-11 shrink-0 text-muted-foreground hover:text-foreground md:size-8' aria-label={t('header.actions.rename')}>
                  <Pencil className='size-3.5' />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>{t('header.actions.rename')}</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className='flex items-center gap-1'>
          {conversation.groupMeta?.isGroup && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant='ghost' size='icon' onClick={() => setGroupDialogOpen(true)} className='size-11 shrink-0 text-primary md:size-9' aria-label={t('newConversation.groupDialog.manageTitle')}>
                    <Users className='h-4 w-4' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t('newConversation.groupDialog.manageTitle')}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {!isGoverned && <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant='ghost' size='icon' onClick={handleShare} className='size-11 shrink-0 md:size-9' aria-label={t('header.tooltips.share')}>
                  <Share className='h-4 w-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t('header.tooltips.share')}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>}
          {!isGoverned && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant='ghost' size='icon' className='size-11 shrink-0 md:size-9' aria-label={t('header.actions.export')} disabled={isExportingDocx}>
                        {isExportingDocx ? <Loader2 className='h-4 w-4 animate-spin' /> : <FileDown className='h-4 w-4' />}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end'>
                      <DropdownMenuItem onClick={() => void handleExportDocx()}>
                        <FileText className='h-3.5 w-3.5 mr-2' />
                        {t('messageActions.exportDocx')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void handleExportPdf()}>
                        <FileDown className='h-3.5 w-3.5 mr-2' />
                        {t('messageActions.exportPdf')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t('header.actions.export')}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant='ghost' size='icon' onClick={() => setDeleteOpen(true)} className='size-11 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive md:size-9' aria-label={t('header.actions.delete')}>
                  <Trash2 className='size-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>{t('header.actions.delete')}</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      <RenameDialog open={renameOpen} onOpenChange={setRenameOpen} currentTitle={conversation.title} onRename={handleRename} />

      <DeleteConversationDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={handleDelete} title={conversation.title} />

      {!isGoverned && <ShareDialog open={shareOpen} onOpenChange={setShareOpen} conversationId={conversation.id} conversationTitle={conversation.title} />}

      {pdfBlocks && (
        <ConversationPdfExport
          blocks={pdfBlocks}
          title={exportTitle}
          onFinish={(ok) => {
            setPdfBlocks(null);
            if (!ok) showError(t('toasts.message.exportError'));
          }}
        />
      )}

      <CreateGroupConversationDialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen} mode='manage' />
    </>
  );
}
