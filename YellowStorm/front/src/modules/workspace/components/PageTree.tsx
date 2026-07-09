import type { PageNode } from '../types';

function Row({ node, depth, selected, onToggle, onFocus }: {
  node: PageNode; depth: number; selected: Set<string>;
  onToggle: (url: string) => void; onFocus: (url: string) => void;
}) {
  const label = node.path === '/' ? (node.title ?? node.url) : node.path;
  return (
    <div>
      <div
        className='flex items-center gap-2 rounded px-1 py-1 hover:bg-accent/50'
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        <input
          type='checkbox'
          aria-label={label}
          checked={selected.has(node.url)}
          disabled={node.alreadyIndexed}
          onChange={() => onToggle(node.url)}
        />
        <button
          type='button'
          className='min-w-0 flex-1 truncate text-left text-sm'
          onClick={() => onFocus(node.url)}
          title={node.url}
        >
          {node.title ? `${node.title} — ${label}` : label}
        </button>
        {node.alreadyIndexed && (
          <span className='shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground'>
            Déjà indexé
          </span>
        )}
      </div>
      {node.children.map((c) => (
        <Row key={c.url} node={c} depth={depth + 1} selected={selected} onToggle={onToggle} onFocus={onFocus} />
      ))}
    </div>
  );
}

export function PageTree({ nodes, selected, onToggle, onFocus }: {
  nodes: PageNode[]; selected: Set<string>;
  onToggle: (url: string) => void; onFocus: (url: string) => void;
}) {
  return (
    <div className='max-h-[50vh] overflow-y-auto'>
      {nodes.map((n) => (
        <Row key={n.url} node={n} depth={0} selected={selected} onToggle={onToggle} onFocus={onFocus} />
      ))}
    </div>
  );
}

/** Collect every non-alreadyIndexed url in the tree (for select-all). */
export function collectSelectableUrls(nodes: PageNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: PageNode[]) => ns.forEach((n) => {
    if (!n.alreadyIndexed) out.push(n.url);
    walk(n.children);
  });
  walk(nodes);
  return out;
}
