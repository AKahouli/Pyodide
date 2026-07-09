import { cn } from '@/lib/utils';
import type { PageNode } from '../types';

function Row({ node, depth, selected, focusUrl, onToggle, onFocus }: {
  node: PageNode; depth: number; selected: Set<string>; focusUrl: string | null;
  onToggle: (url: string) => void; onFocus: (url: string) => void;
}) {
  // A node with a url is a real, selectable page; url === '' is a synthetic
  // group/category header (just there to organise — not indexable).
  const selectable = !!node.url;
  const isFocused = selectable && focusUrl === node.url;
  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-2 rounded px-1 py-1',
          selectable ? 'hover:bg-accent/50' : '',
          isFocused && 'bg-accent',
        )}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        {selectable ? (
          <input
            type='checkbox'
            aria-label={node.name}
            checked={selected.has(node.url)}
            disabled={node.alreadyIndexed}
            onChange={() => onToggle(node.url)}
          />
        ) : (
          <span className='w-3.5 shrink-0' aria-hidden />
        )}
        {selectable ? (
          <button
            type='button'
            className='min-w-0 flex-1 truncate text-left text-sm'
            onClick={() => onFocus(node.url)}
            title={node.title ? `${node.title} — ${node.url}` : node.url}
          >
            {node.name}
          </button>
        ) : (
          <span
            className='min-w-0 flex-1 truncate text-left text-xs font-medium uppercase tracking-wide text-muted-foreground'
            title={node.path}
          >
            {node.name}
          </span>
        )}
        {node.alreadyIndexed && (
          <span className='shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground'>
            Déjà indexé
          </span>
        )}
      </div>
      {node.children.map((c) => (
        <Row
          key={c.url || c.path}
          node={c}
          depth={depth + 1}
          selected={selected}
          focusUrl={focusUrl}
          onToggle={onToggle}
          onFocus={onFocus}
        />
      ))}
    </div>
  );
}

export function PageTree({ nodes, selected, focusUrl = null, onToggle, onFocus }: {
  nodes: PageNode[]; selected: Set<string>; focusUrl?: string | null;
  onToggle: (url: string) => void; onFocus: (url: string) => void;
}) {
  return (
    <div className='h-full overflow-y-auto'>
      {nodes.map((n) => (
        <Row
          key={n.url || n.path}
          node={n}
          depth={0}
          selected={selected}
          focusUrl={focusUrl}
          onToggle={onToggle}
          onFocus={onFocus}
        />
      ))}
    </div>
  );
}

/** Collect every selectable (real page), not-already-indexed url in the tree. */
export function collectSelectableUrls(nodes: PageNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: PageNode[]) => ns.forEach((n) => {
    if (n.url && !n.alreadyIndexed) out.push(n.url);
    walk(n.children);
  });
  walk(nodes);
  return out;
}
