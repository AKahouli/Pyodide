import { Reply } from 'lucide-react';
import type { Message, Conversation } from '../types';

export interface ParentMessagePreviewProps {
  parentMessageId: string;
  allMessages: Message[];
  currentUserId?: string;
  currentConversation: Conversation | null;
}

export function ParentMessagePreview({ parentMessageId, allMessages, currentUserId, currentConversation }: ParentMessagePreviewProps) {
  const parent = allMessages.find((m) => m.id === parentMessageId);
  if (!parent) return null;

  const isAi = parent.conversationType === 'ai';

  const scrollToMessage = () => {
    const element = document.getElementById(`message-${parentMessageId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Optional: Add a brief highlight effect
      element.classList.add('bg-primary/5');
      setTimeout(() => {
        element.classList.remove('bg-primary/5');
      }, 2000);
    }
  };

  // Resolve sender display name
  let senderName: string;
  if (isAi) {
    senderName = 'Assistant';
  } else if (parent.senderId === currentUserId) {
    senderName = 'You';
  } else if (currentConversation?.groupMeta?.isGroup) {
    const member = currentConversation.groupMeta.members.find((m) => m.userId === parent.senderId);
    senderName = member?.name || member?.email?.split('@')[0] || 'User';
  } else {
    senderName = 'User';
  }

  // Get a text snippet from the parent message
  const snippet =
    parent.content ||
    (parent.components?.find((c) => c.type === 'text')?.data?.content as string | undefined) ||
    '…';

  return (
<div 
  className="flex gap-3 max-w-[85%] md:max-w-[75%] cursor-pointer select-none group transition-all duration-200 hover:scale-[1.01]"
  onClick={scrollToMessage}
>

  {/* reply indicator line */}
  <div className="w-1 rounded-full bg-primary/80 shrink-0 transition-colors duration-200 group-hover:bg-primary" />

  {/* parent message preview */}
  <div className="min-w-0 px-4 py-2 rounded-lg bg-muted/30 border border-border/40 backdrop-blur-md shadow-sm transition-shadow duration-200 group-hover:shadow-md">
    
    {/* sender info - only show icon for users */}
    <div className="flex items-center gap-1 mb-1">
      {!isAi && <Reply className="w-3 h-3 text-primary" />}
      <p className="text-[11px] font-semibold text-primary truncate">{senderName}</p>
    </div>

    {/* message snippet */}
    <p className="text-[11px] text-muted-foreground truncate leading-snug">{snippet}</p>

  </div>
</div>
  );
}
