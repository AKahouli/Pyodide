import { type ReactNode } from 'react';
import { Scissors, Copy, ClipboardPaste, AtSign, Bot } from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { useModuleTranslation } from '@/modules/localization';

interface InputContextMenuProps {
  children: ReactNode;
  onMentionAgent: () => void;
  onCreateAgent: () => void;
}

export function InputContextMenu({ children, onMentionAgent, onCreateAgent }: InputContextMenuProps) {
  const { t: tCommon } = useModuleTranslation('common');
  const handleCut = () => {
    document.execCommand('cut');
  };

  const handleCopy = () => {
    document.execCommand('copy');
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      document.execCommand('insertText', false, text);
    } catch {
      document.execCommand('paste');
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className='w-48'>
        <ContextMenuItem onSelect={handleCut}>
          <Scissors className='mr-2 h-4 w-4' />
          {tCommon('context.cut')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={handleCopy}>
          <Copy className='mr-2 h-4 w-4' />
          {tCommon('context.copy')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={handlePaste}>
          <ClipboardPaste className='mr-2 h-4 w-4' />
          {tCommon('context.paste')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onMentionAgent}>
          <AtSign className='mr-2 h-4 w-4' />
          {tCommon('context.mentionAgent')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCreateAgent}>
          <Bot className='mr-2 h-4 w-4' />
          {tCommon('context.createAgent')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
