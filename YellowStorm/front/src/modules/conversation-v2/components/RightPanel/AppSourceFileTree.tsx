import { useState } from 'react';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { FilesTreeNode } from '../../types';
import { useConversationV2Translation } from '../../translation';
import { fileIconForName, formatBytes } from '../../utils/app-source';

interface TreeNodeProps {
  node: FilesTreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  defaultOpen?: boolean;
}

function TreeNode({ node, depth, selectedPath, onSelect, defaultOpen = depth < 2 }: TreeNodeProps) {
  const [open, setOpen] = useState(defaultOpen);
  const isDir = node.type === 'directory';
  const path = node.path ?? '';
  const selected = !isDir && !!path && selectedPath === path;
  const Icon = isDir ? (open ? FolderOpenIcon : FolderIcon) : fileIconForName(node.name);

  if (isDir) {
    const children = node.children ?? [];
    return (
      <div>
        <button
          type='button'
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-xs transition-colors',
            'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
          )}
          style={{ paddingLeft: 6 + depth * 12 }}
        >
          {open ? <ChevronDownIcon className='size-3.5 shrink-0' /> : <ChevronRightIcon className='size-3.5 shrink-0' />}
          <Icon className='size-3.5 shrink-0 text-amber-600/80 dark:text-amber-400/80' />
          <span className='truncate font-medium'>{node.name || '/'}</span>
        </button>
        {open &&
          children.map((child) => (
            <TreeNode
              key={`${child.type}:${child.path ?? child.name}`}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
      </div>
    );
  }

  return (
    <button
      type='button'
      onClick={() => path && onSelect(path)}
      title={path}
      className={cn(
        'flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs transition-colors',
        selected
          ? 'bg-primary/10 text-foreground'
          : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
      )}
      style={{ paddingLeft: 22 + depth * 12 }}
    >
      <Icon className='size-3.5 shrink-0 opacity-80' />
      <span className='min-w-0 flex-1 truncate'>{node.name}</span>
      {node.size != null && node.size > 0 && (
        <span className='shrink-0 text-[10px] tabular-nums opacity-60'>{formatBytes(node.size)}</span>
      )}
    </button>
  );
}

interface AppSourceFileTreeProps {
  tree: FilesTreeNode | null | undefined;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  className?: string;
}

export function AppSourceFileTree({ tree, selectedPath, onSelect, className }: AppSourceFileTreeProps) {
  const { t } = useConversationV2Translation();
  const roots = tree?.children?.length ? tree.children : tree ? [tree] : [];

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className='flex shrink-0 items-center gap-2 border-b px-3 py-2'>
        <FolderIcon className='size-3.5 text-muted-foreground' />
        <span className='text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>
          {t('nodepod.files')}
        </span>
      </div>
      <ScrollArea className='min-h-0 flex-1'>
        <div className='p-1.5'>
          {roots.length === 0 ? (
            <p className='px-2 py-6 text-center text-xs text-muted-foreground'>{t('nodepod.noFiles')}</p>
          ) : (
            roots.map((node) => (
              <TreeNode
                key={`${node.type}:${node.path ?? node.name}`}
                node={node}
                depth={0}
                selectedPath={selectedPath}
                onSelect={onSelect}
                defaultOpen
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
