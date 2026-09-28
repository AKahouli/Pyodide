import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { useModuleTranslation } from '@/modules/localization';
import { AgentComposer } from '@/modules/conversation-v2/components/AgentComposer';
import { startConversationV2AgentSession } from '@/modules/conversation-v2/startAgentSession';
import type { AppTemplate } from '../../types';

interface TemplateDetailDialogProps {
  template: AppTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Super admin only: reveal management actions in the modal footer. */
  isSuperAdmin?: boolean;
  onEdit?: (template: AppTemplate) => void;
  onDelete?: (template: AppTemplate) => void;
}

/**
 * Template detail + launch modal. Reuses the shared AgentComposer (prompt input
 * + AI model selector) and startConversationV2AgentSession so the session,
 * runtime boot and NodePod preview stay on the existing conversation-v2 path —
 * the template revision is seeded server-side via `templateId`.
 */
export function TemplateDetailDialog({
  template,
  open,
  onOpenChange,
  isSuperAdmin = false,
  onEdit,
  onDelete,
}: TemplateDetailDialogProps) {
  const { t } = useModuleTranslation('app-builder');
  const navigate = useNavigate();
  const [isSending, setIsSending] = useState(false);

  const handleSubmit = async (
    message: PromptInputMessage,
    workspaceIds: string[],
    modelId: string | null,
  ) => {
    const text = message.text?.trim() ?? '';
    if (!text || !template || isSending) return;
    setIsSending(true);
    try {
      await startConversationV2AgentSession({
        text,
        workspaceIds,
        modelId,
        navigate,
        source: 'app-builder',
        templateId: template.id,
      });
      onOpenChange(false);
    } catch {
      toast.error(t('templateModal.error'));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (isSending ? undefined : onOpenChange(next))}>
      <DialogContent className='flex max-h-[90vh] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl'>
        {template ? (
          <>
            <div className='relative aspect-[16/7] w-full shrink-0 overflow-hidden bg-muted/40'>
              {template.coverImage ? (
                <img src={template.coverImage} alt='' className='size-full object-cover' />
              ) : null}
            </div>

            <DialogHeader className='border-b px-6 py-4 text-left'>
              <p className='text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground'>
                {template.categoryName}
              </p>
              <DialogTitle className='text-left text-xl'>{template.title}</DialogTitle>
              <DialogDescription className='text-left'>
                {template.description || t('templateModal.noDescription')}
              </DialogDescription>
            </DialogHeader>

            <div className='flex-1 overflow-y-auto px-6 py-5'>
              <p className='mb-3 flex items-center gap-2 text-sm font-semibold text-foreground'>
                {isSending ? <Loader2 className='size-4 animate-spin' aria-hidden /> : null}
                {isSending ? t('templateModal.sending') : t('templateModal.startHeading')}
              </p>
              {/* Remount per open so the composer text resets between templates. */}
              <div className='rounded-xl border border-border/70 bg-background/90 p-2.5 ring-1 ring-border/40'>
                <AgentComposer
                  key={template.id}
                  onSubmit={handleSubmit}
                  disabled={isSending}
                  placeholder={t('templateModal.placeholder')}
                />
              </div>
            </div>

            {isSuperAdmin ? (
              <div className='flex items-center justify-end gap-2 border-t px-6 py-3'>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  className='gap-1.5 text-muted-foreground'
                  onClick={() => onEdit?.(template)}
                >
                  <Pencil className='size-3.5' aria-hidden />
                  {t('admin.editTemplate')}
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  className='gap-1.5 text-fail hover:text-fail'
                  onClick={() => onDelete?.(template)}
                >
                  <Trash2 className='size-3.5' aria-hidden />
                  {t('admin.deleteTemplate')}
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
