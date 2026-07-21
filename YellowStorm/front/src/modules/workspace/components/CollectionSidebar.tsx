import { useCallback, useState } from 'react';
import { ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { normalizeUrl, type CollectedPage } from '../hooks/useBrowserSession';

export interface TrieNode {
  /** Display name for this level: the host at the root, otherwise a path segment. */
  segment: string;
  /** Set when a collected page lives exactly at this path (a selectable leaf/branch). */
  url?: string;
  /** Preferred leaf display name (clicked link text → page title); falls back to `segment` when absent. */
  label?: string;
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
    if (!node.url) {
      node.url = p.url;
      const label = (p.linkText || p.title || '').replace(/\s+/g, ' ').trim();
      if (label) node.label = label;
    }
  }
  return roots;
}

function AddLinkRow({ onAdd }: { onAdd: (url: string, name?: string) => boolean }) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    if (!url.trim()) return;
    const ok = onAdd(url.trim(), name.trim() || undefined);
    if (ok) { setUrl(''); setName(''); setError(null); }
    else setError('URL invalide ou déjà dans la liste.');
  };
  return (
    <div className='flex flex-col gap-1 border-b p-1.5'>
      <div className='flex items-center gap-1'>
        <Input aria-label='URL du lien' value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder='https://…' className='h-7 flex-1 text-xs' />
        <Input aria-label='Nom du lien' value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder='Nom (optionnel)' className='h-7 w-24 text-xs' />
        <button type='button' aria-label='Ajouter le lien' onClick={submit} className='flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground'>
          <Plus className='h-4 w-4' />
        </button>
      </div>
      {error && <p className='text-[11px] text-destructive'>{error}</p>}
    </div>
  );
}

function EditLeafPopover({ node, onEdit }: { node: TrieNode; onEdit: (oldUrl: string, patch: { url?: string; name?: string }) => boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const onOpenChange = (o: boolean) => {
    if (o) { setName(node.label ?? ''); setUrl(node.url ?? ''); setError(null); }
    setOpen(o);
  };
  const save = () => {
    if (!url.trim()) { setError('URL invalide ou déjà dans la liste.'); return; }
    const ok = onEdit(node.url as string, { url: url.trim(), name: name.trim() });
    if (ok) setOpen(false);
    else setError('URL invalide ou déjà dans la liste.');
  };
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button type='button' aria-label={`edit ${node.url}`} className='shrink-0 text-muted-foreground hover:text-foreground'>
          <Pencil className='h-4 w-4' />
        </button>
      </PopoverTrigger>
      <PopoverContent align='end' className='w-64 space-y-2'>
        <div className='space-y-1'>
          <label className='text-xs font-medium'>Nom</label>
          <Input aria-label='Nom du lien à éditer' value={name} onChange={(e) => setName(e.target.value)} className='h-7 text-xs' />
        </div>
        <div className='space-y-1'>
          <label className='text-xs font-medium'>URL</label>
          <Input aria-label='URL du lien à éditer' value={url} onChange={(e) => setUrl(e.target.value)} className='h-7 text-xs' />
        </div>
        {error && <p className='text-[11px] text-destructive'>{error}</p>}
        <div className='flex justify-end gap-2'>
          <button type='button' className='text-xs underline' onClick={() => setOpen(false)}>Annuler</button>
          <button type='button' className='text-xs font-medium text-primary' onClick={save}>Enregistrer</button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TrieRows({
  nodes, parentKey, selected, indexedUrls, collapsed, onToggleCollapse, onToggle, onDelete, onEdit,
}: {
  nodes: TrieNode[];
  parentKey: string;
  selected: Set<string>;
  indexedUrls: Set<string>;
  collapsed: Set<string>;
  onToggleCollapse: (key: string) => void;
  onToggle: (url: string) => void;
  onDelete: (url: string) => void;
  onEdit?: (oldUrl: string, patch: { url?: string; name?: string }) => boolean;
}) {
  return (
    <ul className='m-0 list-none p-0'>
      {nodes.map((node) => {
        const key = `${parentKey}/${node.segment}`;
        const hasChildren = node.children.length > 0;
        const isCollapsed = collapsed.has(key);
        const already = node.url ? indexedUrls.has(normalizeUrl(node.url)) : false;
        const displayName = node.label ?? node.segment;
        return (
          <li key={node.segment}>
            <div className='flex items-center gap-1 border-b py-1 pr-2 text-sm'>
              {hasChildren ? (
                <button
                  type='button'
                  aria-label={`${isCollapsed ? 'expand' : 'collapse'} ${node.segment}`}
                  className='flex size-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground'
                  onClick={() => onToggleCollapse(key)}
                >
                  <ChevronRight className={`size-3.5 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
                </button>
              ) : (
                <span className='size-4 shrink-0' aria-hidden />
              )}

              {node.url ? (
                <>
                  <Checkbox
                    aria-label={displayName}
                    checked={selected.has(node.url)}
                    disabled={already}
                    onCheckedChange={() => onToggle(node.url as string)}
                  />
                  <div className='min-w-0 flex-1'>
                    <div className='truncate font-medium' title={displayName}>{displayName}</div>
                    <div className='truncate text-[11px] text-muted-foreground' title={node.url}>{node.url}</div>
                    {already && <span className='text-[10px] text-muted-foreground'>Déjà indexée</span>}
                  </div>
                  {onEdit && <EditLeafPopover node={node} onEdit={onEdit} />}
                  <button
                    type='button'
                    aria-label={`delete ${node.url}`}
                    className='shrink-0 text-muted-foreground hover:text-destructive'
                    onClick={() => onDelete(node.url as string)}
                  >
                    <Trash2 className='h-4 w-4' />
                  </button>
                </>
              ) : (
                <button
                  type='button'
                  className='min-w-0 flex-1 truncate text-left text-xs font-medium text-muted-foreground'
                  title={node.segment}
                  onClick={() => onToggleCollapse(key)}
                >
                  {node.segment}
                </button>
              )}
            </div>

            {hasChildren && !isCollapsed && (
              <div className='ml-[9px] border-l border-border/60 pl-1'>
                <TrieRows
                  nodes={node.children}
                  parentKey={key}
                  selected={selected}
                  indexedUrls={indexedUrls}
                  collapsed={collapsed}
                  onToggleCollapse={onToggleCollapse}
                  onToggle={onToggle}
                  onDelete={onDelete}
                  onEdit={onEdit}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function CollectionSidebar({
  pages, selected, indexedUrls, onToggle, onDelete, onSelectAll, onSelectNone, onAdd, onEdit,
}: {
  pages: CollectedPage[];
  selected: Set<string>;
  indexedUrls: Set<string>;
  onToggle: (url: string) => void;
  onDelete: (url: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onAdd?: (url: string, name?: string) => boolean;
  onEdit?: (oldUrl: string, patch: { url?: string; name?: string }) => boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const onToggleCollapse = useCallback(
    (key: string) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    [],
  );

  const roots = buildTrie(pages);
  return (
    <div className='flex min-h-0 min-w-0 flex-col rounded border'>
      <div className='flex shrink-0 items-center gap-2 border-b px-2 py-1.5 text-xs'>
        <span className='font-medium'>Pages visitées ({pages.length})</span>
        <button type='button' className='ml-auto underline' onClick={onSelectAll}>Tout</button>
        <span className='text-muted-foreground'>·</span>
        <button type='button' className='underline' onClick={onSelectNone}>Aucun</button>
      </div>
      {onAdd && <AddLinkRow onAdd={onAdd} />}
      <div className='min-h-0 flex-1 overflow-y-auto p-1'>
        {pages.length === 0 ? (
          <p className='p-3 text-sm text-muted-foreground'>Naviguez pour collecter des pages.</p>
        ) : (
          <TrieRows
            nodes={roots}
            parentKey=''
            selected={selected}
            indexedUrls={indexedUrls}
            collapsed={collapsed}
            onToggleCollapse={onToggleCollapse}
            onToggle={onToggle}
            onDelete={onDelete}
            onEdit={onEdit}
          />
        )}
      </div>
    </div>
  );
}
