import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, XCircle, MessageSquare, ShieldCheck, Eye, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { usePlaybookStore, useCurrentExecution } from '../store';
import { handleApiError } from '@/lib/api-error';
import type { HumanFeedbackData } from '../types';
import { useModuleTranslation } from '@/modules/localization';

interface Props {
  data: HumanFeedbackData;
  taskId: string;
}

export function HumanFeedbackInline({ data, taskId }: Props) {
  const { id } = useParams<{ id: string }>();
  const execution = useCurrentExecution();
  const resumeExecution = usePlaybookStore((s) => s.resumeExecution);
  const { t } = useModuleTranslation('playbook');

  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const isPending = data.status === 'pending';
  const isApproval = data.interruptType === 'approval_request';
  const isReview = data.interruptType === 'review_request';
  const isClarification = data.interruptType === 'clarification';

  const handleSubmit = async (response: { approved: boolean; reason?: string; feedback?: string }) => {
    if (!id || !execution) return;
    setIsSubmitting(true);
    try {
      await resumeExecution(id, {
        executionId: execution.id,
        taskId,
        approved: response.approved,
        reason: response.reason,
        feedback: response.feedback,
      });
      setReason('');
      setFeedback('');
      setShowRejectReason(false);
    } catch (err) {
      handleApiError(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Answered state - show the persisted response
  if (!isPending) {
    const wasApproved = data.approved ?? data.humanResponse === 'approved';
    return (
      <div className="rounded-lg border bg-muted/30 p-4 my-3">
        <div className="flex items-center gap-2 mb-2">
          <FeedbackIcon type={data.interruptType} />
          <span className="text-sm font-medium">
            {isApproval
              ? t('interrupt.approvalTitle')
              : isReview
                ? t('interrupt.reviewTitle')
                : t('interrupt.clarificationTitle')}
          </span>
        </div>
        {data.message && (
          <p className="text-sm text-muted-foreground mb-2">{data.message}</p>
        )}
        <div className="flex items-center gap-2 mt-2 rounded-md bg-background border px-3 py-2">
          {isApproval || isReview ? (
            <>
              {wasApproved ? (
                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 text-red-500 shrink-0" />
              )}
              <span className="text-sm font-medium">
                {wasApproved
                  ? t('interrupt.approved')
                  : t('interrupt.rejected')}
              </span>
            </>
          ) : (
            <>
              <MessageSquare className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm">{data.feedback || data.humanResponse}</span>
            </>
          )}
        </div>
        {data.reason && !wasApproved && (
          <p className="text-xs text-muted-foreground mt-1 ml-1">{data.reason}</p>
        )}
        {data.feedback && (isReview || isClarification) && (
          <p className="text-xs text-muted-foreground mt-1 ml-1">{data.feedback}</p>
        )}
      </div>
    );
  }

  // Pending state - interactive
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 my-3">
      <div className="flex items-center gap-2 mb-2">
        <FeedbackIcon type={data.interruptType} />
        <span className="text-sm font-medium">
          {isApproval
            ? t('interrupt.approvalTitle')
            : isReview
              ? t('interrupt.reviewTitle')
              : t('interrupt.clarificationTitle')}
        </span>
      </div>
      {data.message && (
        <p className="text-sm text-muted-foreground mb-3">{data.message}</p>
      )}

      {/* Task description collapsible (approval_request) */}
      {isApproval && data.taskDescription && (
        <div className="mb-3">
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowDetails(!showDetails)}
          >
            {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {t('interrupt.taskDescription')}
          </button>
          {showDetails && (
            <pre className="mt-1 text-xs bg-background border rounded-md p-2 whitespace-pre-wrap max-h-40 overflow-auto">
              {data.taskDescription}
            </pre>
          )}
        </div>
      )}

      {/* Agent result display (review_request) */}
      {isReview && data.result && (
        <div className="mb-3">
          <p className="text-xs text-muted-foreground mb-1">{t('interrupt.agentResult')}</p>
          <pre className="text-xs bg-background border rounded-md p-2 whitespace-pre-wrap max-h-40 overflow-auto">
            {data.result}
          </pre>
        </div>
      )}

      {isApproval ? (
        <div className="space-y-2">
          {showRejectReason && (
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('interrupt.rejectReasonPlaceholder')}
              rows={2}
              className="bg-background"
            />
          )}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!showRejectReason) {
                  setShowRejectReason(true);
                } else {
                  handleSubmit({ approved: false, reason: reason || undefined });
                }
              }}
              disabled={isSubmitting}
            >
              <XCircle className="h-4 w-4 mr-1" />
              {t('interrupt.reject')}
            </Button>
            <Button
              size="sm"
              onClick={() => handleSubmit({ approved: true })}
              disabled={isSubmitting}
            >
              <CheckCircle2 className="h-4 w-4 mr-1" />
              {t('interrupt.approve')}
            </Button>
          </div>
        </div>
      ) : isReview ? (
        <div className="space-y-2">
          <Textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={t('interrupt.responsePlaceholder')}
            rows={3}
            className="bg-background"
          />
          <div className="flex items-center gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSubmit({ approved: false, feedback: feedback || undefined })}
              disabled={isSubmitting}
            >
              <XCircle className="h-4 w-4 mr-1" />
              {t('interrupt.reject')}
            </Button>
            <Button
              size="sm"
              onClick={() => handleSubmit({ approved: true, feedback: feedback || undefined })}
              disabled={isSubmitting}
            >
              <CheckCircle2 className="h-4 w-4 mr-1" />
              {t('interrupt.approve')}
            </Button>
          </div>
        </div>
      ) : (
        /* Clarification */
        <div className="space-y-2">
          <Textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={t('interrupt.responsePlaceholder')}
            rows={3}
            className="bg-background"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => handleSubmit({ approved: true, feedback })}
              disabled={!feedback.trim() || isSubmitting}
            >
              {isSubmitting ? t('common.submitting') : t('interrupt.submit')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function FeedbackIcon({ type }: { type: string }) {
  switch (type) {
    case 'approval_request':
      return <ShieldCheck className="h-4 w-4 text-primary shrink-0" />;
    case 'review_request':
      return <Eye className="h-4 w-4 text-primary shrink-0" />;
    case 'clarification':
      return <MessageSquare className="h-4 w-4 text-primary shrink-0" />;
    default:
      return <MessageSquare className="h-4 w-4 text-primary shrink-0" />;
  }
}
