import { useMemo, useState } from 'react';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  FolderIcon,
  FolderOpenIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { FilesTreeNode } from '../../types';
import { useConversationV2Translation } from '../../translation';
import { fileIconForName, formatBytes } from '../../utils/app-source';
import { countFilesInTree, filterFilesTree } from '../../utils/files-tree';

type ExpansionMode = 'default' | 'all' | 'none';

interface TreeNodeProps {
  node: FilesTreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  expansionMode: ExpansionMode;
  searchActive: boolean;
}

function shouldDefaultOpen(
  depth: number,
  expansionMode: ExpansionMode,
  searchActive: boolean,
): boolean {
  if (searchActive) return true;
  if (expansionMode === 'all') return true;
  if (expansionMode === 'none') return false;
  return depth < 2;
}

function TreeNode({
  node,
  depth,
  selectedPath,
  onSelect,
  expansionMode,
  searchActive,
}: TreeNodeProps) {
  const defaultOpen = shouldDefaultOpen(depth, expansionMode, searchActive);
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
            'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
          )}
          style={{ paddingLeft: 6 + depth * 12 }}
        >
          <span className='flex size-3.5 shrink-0 items-center justify-center'>
            {open ? <ChevronDownIcon className='size-3' /> : <ChevronRightIcon className='size-3' />}
          </span>
          <Icon className='size-3.5 shrink-0 text-amber-600/90 dark:text-amber-400/90' />
          <span className='min-w-0 truncate font-medium'>{node.name || 'project'}</span>
        </button>
        {open &&
          children.map((child) => (
            <TreeNode
              key={`${child.type}:${child.path ?? child.name}`}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              expansionMode={expansionMode}
              searchActive={searchActive}
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
        'flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-xs transition-colors',
        selected
          ? 'bg-primary/12 text-foreground ring-1 ring-primary/20'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}
      style={{ paddingLeft: 22 + depth * 12 }}
    >
      <Icon className='size-3.5 shrink-0 opacity-85' />
      <span className='min-w-0 flex-1 truncate'>{node.name}</span>
      {node.size != null && node.size > 0 && (
        <span className='shrink-0 text-[10px] tabular-nums text-muted-foreground/55'>
          {formatBytes(node.size)}
        </span>
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
  const [search, setSearch] = useState('');
  const [expansionMode, setExpansionMode] = useState<ExpansionMode>('default');

  const fileCount = useMemo(() => countFilesInTree(tree), [tree]);
  const searchActive = search.trim().length > 0;

  const filteredTree = useMemo(
    () => (searchActive ? filterFilesTree(tree, search) : tree),
    [tree, search, searchActive],
  );

  const roots = useMemo(() => {
    if (!filteredTree) return [];
    return filteredTree.children?.length ? filteredTree.children : [filteredTree];
  }, [filteredTree]);

  const treeKey = `${expansionMode}-${searchActive}-${roots.length}`;

  return (
    <div className={cn('flex h-full min-h-0 flex-col overflow-hidden border-r bg-muted/15', className)}>
      <div className='shrink-0 space-y-1.5 border-b bg-card/50 px-2 py-1.5'>
        <div className='flex items-center gap-1'>
          <FolderIcon className='size-3.5 shrink-0 text-primary' />
          <span className='min-w-0 flex-1 truncate text-xs font-semibold'>{t('nodepod.explorer')}</span>
          {fileCount > 0 && (
            <Badge variant='secondary' className='shrink-0 tabular-nums text-[10px] font-normal'>
              {fileCount}
            </Badge>
          )}
          <button
            type='button'
            onClick={() => setExpansionMode('all')}
            className='inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground'
            aria-label={t('nodepod.expandAll')}
          >
            <ChevronsUpDownIcon className='size-3.5' />
          </button>
          <button
            type='button'
            onClick={() => setExpansionMode('none')}
            className='inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground'
            aria-label={t('nodepod.collapseAll')}
          >
            <ChevronsDownUpIcon className='size-3.5' />
          </button>
        </div>

        <div className='relative'>
          <SearchIcon className='pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground' />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('nodepod.searchFiles')}
            className='h-7 bg-background/80 pl-7 pr-7 text-xs'
            aria-label={t('nodepod.searchFiles')}
          />
          {search && (
            <button
              type='button'
              onClick={() => setSearch('')}
              className='absolute right-1 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground'
              aria-label={t('nodepod.clearSearch')}
            >
              <XIcon className='size-3' />
            </button>
          )}
        </div>
      </div>

      <ScrollArea className='min-h-0 flex-1'>
        <div className='p-1.5' key={treeKey}>
          {roots.length === 0 ? (
            <p className='px-2 py-8 text-center text-xs text-muted-foreground'>
              {searchActive ? t('nodepod.noSearchResults') : t('nodepod.noFiles')}
            </p>
          ) : (
            roots.map((node) => (
              <TreeNode
                key={`${node.type}:${node.path ?? node.name}`}
                node={node}
                depth={0}
                selectedPath={selectedPath}
                onSelect={onSelect}
                expansionMode={expansionMode}
                searchActive={searchActive}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
