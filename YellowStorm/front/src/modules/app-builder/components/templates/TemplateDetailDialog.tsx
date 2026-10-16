import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers, Loader2, Pencil, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { AgentComposer } from '@/modules/app-builder-studio/components/AgentComposer';
import {
  startAppBuilderStudioAgentSession,
  startTemplateSession,
} from '@/modules/app-builder-studio/startAgentSession';
import type { AppTemplate } from '../../types';
import { TemplatePreviewFrame } from './TemplatePreviewFrame';

interface TemplateDetailDialogProps {
  template: AppTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isSuperAdmin?: boolean;
  onClone?: (template: AppTemplate) => void | Promise<void>;
  cloning?: boolean;
  onEdit?: (template: AppTemplate) => void;
  onDelete?: (template: AppTemplate) => void;
}

export function TemplateDetailDialog({
  template,
  open,
  onOpenChange,
  isSuperAdmin = false,
  onClone,
  cloning = false,
  onEdit,
  onDelete,
}: TemplateDetailDialogProps) {
  const { t } = useModuleTranslation('app-builder');
  const navigate = useNavigate();
  const [isSending, setIsSending] = useState(false);
  const busy = isSending || cloning;

  const handleClone = async () => {
    if (!template || busy) return;
    if (onClone) {
      await onClone(template);
      onOpenChange(false);
      return;
    }
    setIsSending(true);
    try {
      await startTemplateSession({ templateId: template.id, navigate });
      onOpenChange(false);
    } catch {
      toast.error(t('templates.cloneError'));
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmit = async (
    message: PromptInputMessage,
    workspaceIds: string[],
    modelId: string | null,
  ) => {
    const text = message.text?.trim() ?? '';
    if (!text || !template || busy) return;
    setIsSending(true);
    try {
      await startAppBuilderStudioAgentSession({
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
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent
        className={cn(
          'flex max-h-[min(92vh,880px)] w-[calc(100%-1.5rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl',
          '[&>button:last-child]:right-3 [&>button:last-child]:top-3 [&>button:last-child]:z-20',
          '[&>button:last-child]:rounded-full [&>button:last-child]:border [&>button:last-child]:border-border/60',
          '[&>button:last-child]:bg-background/95 [&>button:last-child]:shadow-sm [&>button:last-child]:backdrop-blur-sm',
        )}
      >
        {template ? (
          <div className='flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:grid-rows-1'>
            {/* Preview panel */}
            <div className='relative flex min-h-[200px] flex-col border-b border-border/60 bg-muted/20 lg:min-h-0 lg:border-b-0 lg:border-r'>
              <div className='flex items-center justify-between gap-2 px-4 pb-2 pt-4 lg:px-5 lg:pt-5'>
                <p className='text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground'>
                  {t('templateModal.previewLabel')}
                </p>
              </div>
              <div className='flex flex-1 items-center justify-center px-4 pb-4 pt-1 lg:px-5 lg:pb-6'>
                <TemplatePreviewFrame
                  src={template.coverImage}
                  title={template.title}
                  emptyLabel={t('templateModal.noPreview')}
                  variant='window'
                  chrome='bar'
                  className='w-full max-w-md'
                />
              </div>
            </div>

            {/* Details + composer */}
            <div className='flex min-h-0 flex-1 flex-col'>
              <div className='space-y-3 border-b border-border/60 px-5 py-5 sm:px-6'>
                <span className='inline-flex items-center rounded-full border border-border/70 bg-muted/40 px-2.5 py-0.5 text-xs font-medium text-muted-foreground'>
                  {template.categoryName}
                </span>
                <DialogTitle className='text-left text-xl font-semibold leading-tight tracking-tight sm:text-2xl'>
                  {template.title}
                </DialogTitle>
                <DialogDescription className='text-left text-sm leading-relaxed text-muted-foreground'>
                  {template.description || t('templateModal.noDescription')}
                </DialogDescription>
                <Button
                  type='button'
                  variant='outline'
                  className='h-10 gap-2 rounded-full'
                  disabled={busy}
                  aria-label={t('templates.cloneAria', { title: template.title })}
                  onClick={() => void handleClone()}
                >
                  {busy && cloning ? (
                    <Loader2 className='size-4 animate-spin' aria-hidden />
                  ) : (
                    <Layers className='size-4' aria-hidden />
                  )}
                  {cloning ? t('templates.cloning') : t('templates.clone')}
                </Button>
              </div>

              <div className='min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6'>
                <div className='space-y-3'>
                  <div className='flex items-start gap-2.5'>
                    <span className='mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
                      <Sparkles className='size-4' aria-hidden />
                    </span>
                    <div className='min-w-0 space-y-1'>
                      <p className='text-sm font-semibold text-foreground'>
                        {isSending && !cloning
                          ? t('templateModal.sending')
                          : t('templateModal.startHeading')}
                      </p>
                      <p className='text-sm leading-relaxed text-muted-foreground'>
                        {t('templateModal.startHint')}
                      </p>
                    </div>
                    {isSending && !cloning ? (
                      <Loader2 className='ml-auto size-5 shrink-0 animate-spin text-muted-foreground' aria-hidden />
                    ) : null}
                  </div>

                  <div className='rounded-xl border border-border/70 bg-card/80 p-3 shadow-sm ring-1 ring-border/40'>
                    <AgentComposer
                      key={template.id}
                      onSubmit={handleSubmit}
                      disabled={busy}
                      placeholder={t('templateModal.placeholder')}
                    />
                  </div>
                </div>

              </div>

              {isSuperAdmin ? (
                <div className='flex flex-wrap items-center justify-end gap-2 border-t border-border/60 px-5 py-3 sm:px-6'>
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
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
