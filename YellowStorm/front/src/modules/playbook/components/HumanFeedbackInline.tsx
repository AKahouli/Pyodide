import { CheckCircle2, XCircle, MessageSquare, ShieldCheck, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlaybookStore } from '../store';
import type { HumanFeedbackData } from '../types';
import { useModuleTranslation } from '@/modules/localization';

interface Props {
  data: HumanFeedbackData;
  taskId: string;
}

export function HumanFeedbackInline({ data, taskId }: Props) {
  const { t } = useModuleTranslation('playbook');
  const setDesignerOpen = usePlaybookStore((s) => s.setDesignerOpen);
  const setCopilotMode = usePlaybookStore((s) => s.setCopilotMode);
  const selectStep = usePlaybookStore((s) => s.selectStep);

  const isPending = data.status === 'pending';
  const isApproval = data.interruptType === 'approval_request';
  const isReview = data.interruptType === 'review_request';
  const isClarification = data.interruptType === 'clarification';

  const openCopilot = () => {
    selectStep(taskId);
    setCopilotMode('interrupt');
    setDesignerOpen(true);
  };

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
                {wasApproved ? t('interrupt.approved') : t('interrupt.rejected')}
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
      <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
        <p className="text-xs text-muted-foreground">{t('interrupt.answerInCopilot')}</p>
        <Button size="sm" onClick={openCopilot}>
          {t('interrupt.openCopilot')}
        </Button>
      </div>
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
