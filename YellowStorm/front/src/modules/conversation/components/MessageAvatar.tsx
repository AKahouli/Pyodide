import { useMemo } from 'react';
import { Bot } from 'lucide-react';
import type { Message, Conversation } from '../types';
import { cn } from '@/lib/utils';

interface MessageAvatarProps {
  message: Message;
  currentConversation: Conversation | null;
  className?: string;
}

export function MessageAvatar({ message, currentConversation, className }: MessageAvatarProps) {
  const isUser = message.conversationType === 'user';
  const isGroup = !!currentConversation?.groupMeta?.isGroup;
  
  const avatarData = useMemo(() => {
    if (isUser) {
      // Return null if not in a group to match current logic (optional)
      if (!isGroup && message.senderId) return null;
      
      const member = currentConversation?.groupMeta?.members?.find((m) => m.userId === message.senderId);
      const name = member?.name || member?.email || 'User';
      
      const initials = name
        .split(/[ @._-]/)
        .filter(Boolean)
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();
        
      return {
        type: 'user',
        initials,
        style: 'bg-foreground text-background',
      };
    } else {
      // AI message - ONLY show in group chats
      if (!isGroup) return null;

      return {
        type: 'ai',
        icon: Bot,
        style: 'bg-muted text-muted-foreground border border-border/50',
      };
    }
  }, [isUser, isGroup, message.senderId, currentConversation]);

  if (!avatarData) return null;

  // Use a capital letter variable for the component icon to avoid TS errors
  const IconComponent = avatarData.type === 'ai' ? avatarData.icon : null;

  return (
    <div className={cn(
      'flex-shrink-0 h-9 w-9 animate-in zoom-in-50 duration-300 relative select-none group/avatar',
      className
    )}>
      {avatarData.type === 'user' ? (
        <span className={cn(
          "flex h-full w-full items-center justify-center rounded-xl font-semibold text-[13px] shadow-sm",
          avatarData.style
        )}>
          {avatarData.initials}
        </span>
      ) : (
        <span className={cn(
          "flex h-full w-full items-center justify-center rounded-xl shadow-sm transition-transform group-hover/avatar:scale-105 duration-200",
          avatarData.style
        )}>
          {IconComponent && <IconComponent className="h-5 w-5" />}
        </span>
      )}
      
      {/* Tiny inner ring for depth */}
      <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-black/10 dark:ring-white/10 pointer-events-none" />
    </div>
  );
}
