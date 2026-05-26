import { useState, useEffect, useRef, type KeyboardEvent } from 'react';
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
import { Badge } from '@/components/ui/badge';
import { usePlaybookStore, useCurrentExecution } from '../store';
import type { InterruptPayload } from '../types';
import { useModuleTranslation } from '@/modules/localization';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timeoutSeconds?: number;
  iterationIndex?: number;
  iterationCount?: number;
}

export function InterruptDialog({ open, onOpenChange, timeoutSeconds, iterationIndex, iterationCount }: Props) {
  const { id } = useParams<{ id: string }>();
  const rawExecution = useCurrentExecution();
  const execution = rawExecution?.playbookId === id ? rawExecution : null;
  const resumeExecution = usePlaybookStore((s) => s.resumeExecution);
  const { t } = useModuleTranslation('playbook');

  const [response, setResponse] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editedMessage, setEditedMessage] = useState('');
  const [remainingSeconds, setRemainingSeconds] = useState(timeoutSeconds ?? 0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  useEffect(() => {
    if (timeoutSeconds && timeoutSeconds > 0) {
      setRemainingSeconds(timeoutSeconds);
    }
  }, [timeoutSeconds]);

  useEffect(() => {
    if (!open || !timeoutSeconds || timeoutSeconds <= 0) return;

    timerRef.current = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [open, timeoutSeconds]);

  useEffect(() => {
    if (!open || !interrupt || !execution || !id) return;

    setResponse('');
    setEditMode(false);
    setEditedMessage(interrupt.message || '');
  }, [open, interrupt, execution, id]);

  if (!interrupt || !execution || !id) return null;

  const isApproval = interrupt.type === 'approval_request';
  const isClarification = interrupt.type === 'clarification';
  const isTimedOut = timeoutSeconds ? remainingSeconds <= 0 : false;
  const showTimeout = timeoutSeconds && timeoutSeconds > 0;
  const showIteration = iterationCount != null && iterationCount > 1;

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

  const handleEditSubmit = async () => {
    await handleSubmit(true, { feedback: editedMessage });
  };

  const handleResponseKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (!response.trim() || isSubmitting) return;
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
          <DialogDescription className="space-y-2">
            <span>{interrupt.message || t('interrupt.defaultMessage')}</span>
            {showIteration && (
              <div>
                <Badge variant="outline" className="text-[10px]">
                  {t('interrupt.iterationContext', { current: (iterationIndex ?? 0) + 1, total: iterationCount })}
                </Badge>
              </div>
            )}
          </DialogDescription>
        </DialogHeader>

        {showTimeout && (
          <div className={`text-center text-sm font-medium ${remainingSeconds <= 10 ? 'text-destructive' : 'text-muted-foreground'}`}>
            {remainingSeconds > 0
              ? t('interrupt.timeoutRemaining', { seconds: remainingSeconds })
              : t('interrupt.timeoutExpired')}
          </div>
        )}

        {isApproval ? (
          editMode ? (
            <>
              <Textarea
                value={editedMessage}
                onChange={(e) => setEditedMessage(e.target.value)}
                placeholder={t('interrupt.editPlaceholder')}
                rows={3}
              />
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setEditMode(false)} disabled={isSubmitting}>
                  {t('common.cancel')}
                </Button>
                <Button onClick={() => handleEditSubmit()} disabled={isSubmitting || isTimedOut}>
                  {t('interrupt.submit')}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => setEditMode(true)}
                disabled={isSubmitting || isTimedOut}
              >
                {t('interrupt.edit')}
              </Button>
              <Button
                variant="outline"
                onClick={() => handleSubmit(false)}
                disabled={isSubmitting || isTimedOut}
              >
                {t('interrupt.reject')}
              </Button>
              <Button
                onClick={() => handleSubmit(true)}
                disabled={isSubmitting || isTimedOut}
              >
                {t('interrupt.approve')}
              </Button>
            </DialogFooter>
          )
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
