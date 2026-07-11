import { Trash2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { normalizeUrl, type CollectedPage } from '../hooks/useBrowserSession';

export interface TrieNode {
  /** Display name for this level: the host at the root, otherwise a path segment. */
  segment: string;
  /** Set when a collected page lives exactly at this path (a selectable leaf/branch). */
  url?: string;
  children: TrieNode[];
}

/**
 * Build a path hierarchy from the collected pages: host → path segments. Pages that
 * share a prefix (e.g. `/a/b` and `/a/c`) nest under the same `a` category. A node can
 * be both a visited page (has `url`) and a category (has children).
 */
export function buildTrie(pages: CollectedPage[]): TrieNode[] {
  const roots: TrieNode[] = [];
  const rootByHost = new Map<string, TrieNode>();
  for (const p of pages) {
    let host: string;
    let segments: string[];
    try {
      const u = new URL(p.url);
      host = u.hostname;
      segments = u.pathname
        .split('/')
        .filter(Boolean)
        .map((s) => {
          try {
            return decodeURIComponent(s);
          } catch {
            return s;
          }
        });
    } catch {
      host = p.url;
      segments = [];
    }
    const existing = rootByHost.get(host);
    let node: TrieNode;
    if (existing) {
      node = existing;
    } else {
      node = { segment: host, children: [] };
      rootByHost.set(host, node);
      roots.push(node);
    }
    for (const seg of segments) {
      let child: TrieNode | undefined = node.children.find((c) => c.segment === seg);
      if (!child) {
        child = { segment: seg, children: [] };
        node.children.push(child);
      }
      node = child;
    }
    if (!node.url) node.url = p.url;
  }
  return roots;
}

function TrieRows({
  nodes, depth, selected, indexedUrls, onToggle, onDelete,
}: {
  nodes: TrieNode[];
  depth: number;
  selected: Set<string>;
  indexedUrls: Set<string>;
  onToggle: (url: string) => void;
  onDelete: (url: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        const pad = depth * 14 + 8;
        const already = node.url ? indexedUrls.has(normalizeUrl(node.url)) : false;
        return (
          <div key={node.segment}>
            {node.url ? (
              <div className='flex items-center gap-2 border-b py-1.5 pr-2 text-sm' style={{ paddingLeft: pad }}>
                <Checkbox
                  aria-label={node.segment}
                  checked={selected.has(node.url)}
                  disabled={already}
                  onCheckedChange={() => onToggle(node.url as string)}
                />
                <div className='min-w-0 flex-1'>
                  <div className='truncate font-medium' title={node.segment}>{node.segment}</div>
                  <div className='truncate text-[11px] text-muted-foreground' title={node.url}>{node.url}</div>
                  {already && <span className='text-[10px] text-muted-foreground'>Déjà indexée</span>}
                </div>
                <button
                  type='button'
                  aria-label={`delete ${node.url}`}
                  className='shrink-0 text-muted-foreground hover:text-destructive'
                  onClick={() => onDelete(node.url as string)}
                >
                  <Trash2 className='h-4 w-4' />
                </button>
              </div>
            ) : (
              <div
                className='flex items-center border-b bg-muted/40 py-1 pr-2 text-xs font-medium text-muted-foreground'
                style={{ paddingLeft: pad }}
              >
                <span className='truncate' title={node.segment}>{node.segment}</span>
              </div>
            )}
            {node.children.length > 0 && (
              <TrieRows
                nodes={node.children}
                depth={depth + 1}
                selected={selected}
                indexedUrls={indexedUrls}
                onToggle={onToggle}
                onDelete={onDelete}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

export function CollectionSidebar({
  pages, selected, indexedUrls, onToggle, onDelete, onSelectAll, onSelectNone,
}: {
  pages: CollectedPage[];
  selected: Set<string>;
  indexedUrls: Set<string>;
  onToggle: (url: string) => void;
  onDelete: (url: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
}) {
  const roots = buildTrie(pages);
  return (
    <div className='flex min-h-0 min-w-0 flex-col rounded border'>
      <div className='flex shrink-0 items-center gap-2 border-b px-2 py-1.5 text-xs'>
        <span className='font-medium'>Pages visitées ({pages.length})</span>
        <button type='button' className='ml-auto underline' onClick={onSelectAll}>Tout</button>
        <span className='text-muted-foreground'>·</span>
        <button type='button' className='underline' onClick={onSelectNone}>Aucun</button>
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        {pages.length === 0 ? (
          <p className='p-3 text-sm text-muted-foreground'>Naviguez pour collecter des pages.</p>
        ) : (
          <TrieRows
            nodes={roots}
            depth={0}
            selected={selected}
            indexedUrls={indexedUrls}
            onToggle={onToggle}
            onDelete={onDelete}
          />
        )}
      </div>
    </div>
  );
}
