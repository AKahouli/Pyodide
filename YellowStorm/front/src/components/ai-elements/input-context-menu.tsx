import { type ReactNode } from 'react';
import { Scissors, Copy, ClipboardPaste, AtSign, Bot } from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { useModuleTranslation } from '@/modules/localization';
import { useProviderAttachments } from './prompt-input';

interface InputContextMenuProps {
  children: ReactNode;
  onMentionAgent: () => void;
  onCreateAgent: () => void;
}

export function InputContextMenu({ children, onMentionAgent, onCreateAgent }: InputContextMenuProps) {
  const { t: tCommon } = useModuleTranslation('common');
  const attachments = useProviderAttachments();
  const handleCut = () => {
    document.execCommand('cut');
  };

  const handleCopy = () => {
    document.execCommand('copy');
  };

  const handlePaste = async () => {
    try {
      // Match keyboard paste: Office selections stay text; screenshots become
      // attachments so they pass through the normal upload/ownership checks.
      if (navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        const textItem = items.find((item) => item.types.includes('text/plain'));
        const text = textItem ? await (await textItem.getType('text/plain')).text() : '';
        if (text) {
          document.execCommand('insertText', false, text);
          return;
        }
        const files: File[] = [];
        for (const item of items) {
          const type = item.types.find((value) => value.startsWith('image/'));
          if (type) {
            const blob = await item.getType(type);
            const extension = type === 'image/jpeg' ? 'jpg' : type.split('/')[1];
            files.push(new File([blob], `clipboard-image.${extension}`, { type }));
          }
        }
        if (files.length) {
          attachments.add(files);
          return;
        }
      }
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
          <Scissors className='me-2 h-4 w-4' />
          {tCommon('context.cut')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={handleCopy}>
          <Copy className='me-2 h-4 w-4' />
          {tCommon('context.copy')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={handlePaste}>
          <ClipboardPaste className='me-2 h-4 w-4' />
          {tCommon('context.paste')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onMentionAgent}>
          <AtSign className='me-2 h-4 w-4' />
          {tCommon('context.mentionAgent')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCreateAgent}>
          <Bot className='me-2 h-4 w-4' />
          {tCommon('context.createAgent')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
