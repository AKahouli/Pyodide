import { cn } from '@/lib/utils';
import { useConversationV2Translation } from '../translation';

interface ThinkingIndicatorProps {
  className?: string;
  text?: string;
}

export function ThinkingIndicator({ className, text }: ThinkingIndicatorProps) {
  const { t } = useConversationV2Translation();
  const label = text ?? t('conversation.thinking');

  return (
    <div className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}>
      <span>{label}</span>
      <span className='flex items-end gap-1'>
        <span className='size-1 animate-conv-v2-bounce rounded-full bg-muted-foreground' style={{ animationDelay: '0ms' }} />
        <span className='size-1 animate-conv-v2-bounce rounded-full bg-muted-foreground' style={{ animationDelay: '200ms' }} />
        <span className='size-1 animate-conv-v2-bounce rounded-full bg-muted-foreground' style={{ animationDelay: '400ms' }} />
      </span>
    </div>
  );
}
