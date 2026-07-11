import { Trash2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { normalizeUrl, type CollectedPage } from '../hooks/useBrowserSession';

/** The page's short name: the last path segment of the URL, falling back to the host for a site root. */
export function pageName(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    return last ? decodeURIComponent(last) : u.hostname;
  } catch {
    return url;
  }
}

/** Category label used to group pages that share the same site. */
function originLabel(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

interface Group {
  label: string;
  items: CollectedPage[];
}

/** Group pages by host, preserving the order each host (and each page) first appeared. */
function groupByOrigin(pages: CollectedPage[]): Group[] {
  const groups: Group[] = [];
  const byLabel = new Map<string, Group>();
  for (const p of pages) {
    const label = originLabel(p.url);
    let group = byLabel.get(label);
    if (!group) {
      group = { label, items: [] };
      byLabel.set(label, group);
      groups.push(group);
    }
    group.items.push(p);
  }
  return groups;
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
  const groups = groupByOrigin(pages);
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
          groups.map((group) => (
            <div key={group.label}>
              <div className='sticky top-0 flex items-center gap-1 border-b bg-muted/60 px-2 py-1 text-xs font-medium text-muted-foreground'>
                <span className='truncate' title={group.label}>{group.label}</span>
                <span className='shrink-0'>({group.items.length})</span>
              </div>
              {group.items.map((p) => {
                const already = indexedUrls.has(normalizeUrl(p.url));
                const name = pageName(p.url);
                return (
                  <div key={p.url} className='flex items-center gap-2 border-b py-1.5 pl-4 pr-2 text-sm'>
                    <Checkbox
                      aria-label={name}
                      checked={selected.has(p.url)}
                      disabled={already}
                      onCheckedChange={() => onToggle(p.url)}
                    />
                    <div className='min-w-0 flex-1'>
                      <div className='truncate font-medium' title={name}>{name}</div>
                      <div className='truncate text-[11px] text-muted-foreground' title={p.url}>{p.url}</div>
                      {already && <span className='text-[10px] text-muted-foreground'>Déjà indexée</span>}
                    </div>
                    <button
                      type='button'
                      aria-label={`delete ${p.url}`}
                      className='shrink-0 text-muted-foreground hover:text-destructive'
                      onClick={() => onDelete(p.url)}
                    >
                      <Trash2 className='h-4 w-4' />
                    </button>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
