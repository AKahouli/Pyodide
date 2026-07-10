import { Trash2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { normalizeUrl, type CollectedPage } from '../hooks/useBrowserSession';

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
          pages.map((p) => {
            const already = indexedUrls.has(normalizeUrl(p.url));
            return (
              <div key={p.url} className='flex items-center gap-2 border-b px-2 py-1.5 text-sm'>
                <Checkbox
                  aria-label={p.title}
                  checked={selected.has(p.url)}
                  disabled={already}
                  onCheckedChange={() => onToggle(p.url)}
                />
                <div className='min-w-0 flex-1'>
                  <div className='truncate' title={p.title}>{p.title}</div>
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
          })
        )}
      </div>
    </div>
  );
}
