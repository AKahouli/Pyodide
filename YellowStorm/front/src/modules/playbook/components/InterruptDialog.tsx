import { useState, type KeyboardEvent } from 'react';
import { useParams } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { usePlaybookStore, useCurrentExecution } from '../store';
import type { InterruptPayload } from '../types';
import { useModuleTranslation } from '@/modules/localization';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InterruptDialog({ open, onOpenChange }: Props) {
  const { id } = useParams<{ id: string }>();
  const rawExecution = useCurrentExecution();
  const execution = rawExecution?.playbookId === id ? rawExecution : null;
  const resumeExecution = usePlaybookStore((s) => s.resumeExecution);
  const { t } = useModuleTranslation('playbook');

  const [response, setResponse] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const pendingHistoryEntry = execution?.waitingForHumanInput
    ? execution.hitlHistory?.find((entry) => entry.status === 'pending' && entry.taskId === (execution.currentInterruptTaskId || entry.taskId))
    : undefined;
  const interrupt = (execution?.interruptPayload || (pendingHistoryEntry
    ? {
        type: pendingHistoryEntry.type,
        taskId: pendingHistoryEntry.taskId,
        taskTitle: pendingHistoryEntry.taskTitle,
        message: pendingHistoryEntry.message,
        threadId: execution?.threadId || '',
        interruptId: pendingHistoryEntry.interruptId,
        round: pendingHistoryEntry.round,
        payloadJson: pendingHistoryEntry.payloadJson,
        resumableActions: pendingHistoryEntry.resumableActions,
        taskDescription: pendingHistoryEntry.taskDescription,
        result: pendingHistoryEntry.result,
      }
    : null)) as InterruptPayload | null;
  if (!interrupt || !execution || !id) return null;

  const isApproval = interrupt.type === 'approval_request';
  const isClarification = interrupt.type === 'clarification';

  const handleSubmit = async (approved: boolean, extra?: { reason?: string; feedback?: string }) => {
    setIsSubmitting(true);
    try {
      await resumeExecution(id, {
        executionId: execution.id,
        taskId: interrupt.taskId,
        interruptId: interrupt.interruptId,
        approved,
        reason: extra?.reason,
        feedback: extra?.feedback,
      });
      onOpenChange(false);
      setResponse('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResponseKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) {
      return;
    }

    e.preventDefault();
    if (!response.trim() || isSubmitting) {
      return;
    }

    void handleSubmit(true, { feedback: response });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isApproval
              ? t('interrupt.approvalTitle')
              : isClarification
                ? t('interrupt.clarificationTitle')
                : t('interrupt.reviewTitle')}
          </DialogTitle>
          <DialogDescription>
            {interrupt.message || t('interrupt.defaultMessage')}
          </DialogDescription>
        </DialogHeader>

        {isApproval ? (
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => handleSubmit(false)}
              disabled={isSubmitting}
            >
              {t('interrupt.reject')}
            </Button>
            <Button
              onClick={() => handleSubmit(true)}
              disabled={isSubmitting}
            >
              {t('interrupt.approve')}
            </Button>
          </DialogFooter>
        ) : (
          <>
            <Textarea
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              placeholder={t('interrupt.responsePlaceholder')}
              rows={3}
              onKeyDown={handleResponseKeyDown}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={() => handleSubmit(true, { feedback: response })}
                disabled={!response.trim() || isSubmitting}
              >
                {isSubmitting ? t('common.submitting') : t('interrupt.submit')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
