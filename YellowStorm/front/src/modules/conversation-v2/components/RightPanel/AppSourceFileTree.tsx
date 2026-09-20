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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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
            'flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs transition-colors',
            'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
          )}
          style={{ paddingLeft: 8 + depth * 12 }}
        >
          <span className='flex size-3.5 shrink-0 items-center justify-center text-muted-foreground/80'>
            {open ? <ChevronDownIcon className='size-3' /> : <ChevronRightIcon className='size-3' />}
          </span>
          <Icon className='size-3.5 shrink-0 text-muted-foreground' />
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
      title={node.name}
      className={cn(
        'flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs transition-colors',
        selected
          ? 'bg-primary/10 text-foreground ring-1 ring-inset ring-primary/20'
          : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
      )}
      style={{ paddingLeft: 24 + depth * 12 }}
    >
      <Icon className='size-3.5 shrink-0 opacity-80' />
      <span className='min-w-0 flex-1 truncate'>{node.name}</span>
      {node.size != null && node.size > 0 && (
        <span className='shrink-0 text-[10px] tabular-nums text-muted-foreground/50'>
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
    <div
      className={cn(
        'flex h-full min-h-0 flex-col overflow-hidden border-r border-border/80 bg-muted/20',
        className,
      )}
    >
      <div className='shrink-0 space-y-2 border-b border-border/80 bg-card/50 px-2.5 py-2'>
        <div className='flex items-center gap-1'>
          <FolderIcon className='size-3.5 shrink-0 text-muted-foreground' />
          <span className='min-w-0 flex-1 truncate text-xs font-semibold tracking-tight'>
            {t('nodepod.explorer')}
          </span>
          {fileCount > 0 && (
            <Badge
              variant='secondary'
              className='h-5 shrink-0 px-1.5 tabular-nums text-[10px] font-normal'
            >
              {fileCount}
            </Badge>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type='button'
                variant='ghost'
                size='icon-sm'
                className='size-7 text-muted-foreground'
                onClick={() => setExpansionMode('all')}
                aria-label={t('nodepod.expandAll')}
              >
                <ChevronsUpDownIcon className='size-3.5' />
              </Button>
            </TooltipTrigger>
            <TooltipContent side='bottom' className='text-xs'>
              {t('nodepod.expandAll')}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type='button'
                variant='ghost'
                size='icon-sm'
                className='size-7 text-muted-foreground'
                onClick={() => setExpansionMode('none')}
                aria-label={t('nodepod.collapseAll')}
              >
                <ChevronsDownUpIcon className='size-3.5' />
              </Button>
            </TooltipTrigger>
            <TooltipContent side='bottom' className='text-xs'>
              {t('nodepod.collapseAll')}
            </TooltipContent>
          </Tooltip>
        </div>

        <div className='relative'>
          <SearchIcon className='pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground' />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('nodepod.searchFiles')}
            className='h-8 bg-background/90 pl-8 pr-8 text-xs shadow-none'
            aria-label={t('nodepod.searchFiles')}
          />
          {search && (
            <Button
              type='button'
              variant='ghost'
              size='icon-sm'
              onClick={() => setSearch('')}
              className='absolute right-1 top-1/2 size-6 -translate-y-1/2 text-muted-foreground'
              aria-label={t('nodepod.clearSearch')}
            >
              <XIcon className='size-3' />
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className='min-h-0 flex-1'>
        <div className='p-1.5' key={treeKey}>
          {roots.length === 0 ? (
            <div className='flex flex-col items-center gap-2 px-3 py-10 text-center'>
              <FolderIcon className='size-5 text-muted-foreground/40' />
              <p className='text-xs text-muted-foreground'>
                {searchActive ? t('nodepod.noSearchResults') : t('nodepod.noFiles')}
              </p>
            </div>
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
