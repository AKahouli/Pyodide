import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { crawlUrl } from '../api';
import { useWorkspaceStore } from '../store';
import type { PageNode } from '../types';
import { PageTree, collectSelectableUrls } from './PageTree';

function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function collectPreChecked(nodes: PageNode[]): Set<string> {
  // Pre-check the root(s) only, skipping already-indexed.
  const s = new Set<string>();
  nodes.forEach((n) => { if (!n.alreadyIndexed) s.add(n.url); });
  return s;
}

export function AddLinkDialog({
  open, onOpenChange, workspaceId, initialUrl = '',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  initialUrl?: string;
}) {
  const addPageLinks = useWorkspaceStore((s) => s.addPageLinks);
  const [phase, setPhase] = useState<'input' | 'tree'>('input');
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tree, setTree] = useState<PageNode[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusUrl, setFocusUrl] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPhase('input'); setUrl(initialUrl); setError(null); setBusy(false);
      setTree([]); setTruncated(false); setSelected(new Set()); setFocusUrl(null);
    }
  }, [open, initialUrl]);

  const selectableCount = useMemo(() => collectSelectableUrls(tree).length, [tree]);

  const handleCrawl = async () => {
    if (busy) return;
    setError(null);
    if (!isValidUrl(url)) {
      setError('Veuillez saisir une URL valide (http:// ou https://).');
      return;
    }
    const clean = url.trim();
    setBusy(true);
    try {
      const res = await crawlUrl(workspaceId, clean);
      if (res.unreachable) {
        setError('Ce site est injoignable. Vérifiez le lien et réessayez.');
        return;
      }
      setTree(res.tree);
      setTruncated(res.truncated);
      setSelected(collectPreChecked(res.tree));
      setFocusUrl(res.tree[0]?.url ?? clean);
      setPhase('tree');
    } catch {
      setError('Une erreur est survenue lors de la cartographie. Réessayez.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (u: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(u) ? n.delete(u) : n.add(u); return n; });
  const selectAll = () => setSelected(new Set(collectSelectableUrls(tree)));
  const selectNone = () => setSelected(new Set());

  const handleAdd = async () => {
    if (busy || selected.size === 0) return;
    setBusy(true);
    try {
      await addPageLinks(workspaceId, [...selected]);
      toast.success(`${selected.size} page(s) ajoutée(s) · conversion en cours`);
      onOpenChange(false);
    } catch {
      setError('Une erreur est survenue lors de l\'ajout. Réessayez.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className={phase === 'tree' ? 'max-w-4xl' : undefined}>
        <DialogHeader>
          <DialogTitle>Ajouter un lien</DialogTitle>
          <DialogDescription>
            {phase === 'input'
              ? "Indexez le contenu d'un site web. Cartographiez le site pour choisir les pages à indexer."
              : 'Sélectionnez les pages à indexer. Chaque page sera convertie en PDF puis indexée.'}
          </DialogDescription>
        </DialogHeader>

        {phase === 'input' ? (
          <div className='space-y-2'>
            <Label htmlFor='workspace-link-url'>Lien du site web</Label>
            <Input
              id='workspace-link-url'
              placeholder='https://exemple.com'
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleCrawl(); }}
              autoFocus
              disabled={busy}
            />
            {error && <p className='text-sm text-destructive'>{error}</p>}
          </div>
        ) : (
          <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
            <div className='min-w-0'>
              <div className='mb-2 flex items-center gap-2 text-xs'>
                <button type='button' className='underline' onClick={selectAll}>Tout sélectionner</button>
                <span className='text-muted-foreground'>·</span>
                <button type='button' className='underline' onClick={selectNone}>Aucun</button>
                {truncated && <span className='ml-auto text-muted-foreground'>Résultats limités</span>}
              </div>
              <PageTree nodes={tree} selected={selected} onToggle={toggle} onFocus={setFocusUrl} />
            </div>
            <div className='min-w-0'>
              {focusUrl ? (
                <div className='flex h-full flex-col'>
                  <div className='mb-1 flex items-center gap-2 text-xs text-muted-foreground'>
                    <span className='truncate' title={focusUrl}>{focusUrl}</span>
                    <a href={focusUrl} target='_blank' rel='noreferrer'
                       className='ml-auto inline-flex items-center gap-1 underline'>
                      Ouvrir <ExternalLink className='h-3 w-3' />
                    </a>
                  </div>
                  <iframe
                    title='Aperçu'
                    src={focusUrl}
                    sandbox='allow-scripts allow-same-origin'
                    className='h-[45vh] w-full rounded border'
                  />
                  <p className='mt-1 text-[11px] text-muted-foreground'>
                    L'aperçu peut être indisponible pour certains sites.
                  </p>
                </div>
              ) : (
                <p className='text-sm text-muted-foreground'>Sélectionnez une page pour l'aperçu.</p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          {phase === 'input' ? (
            <>
              <Button variant='outline' onClick={() => onOpenChange(false)} disabled={busy}>Annuler</Button>
              <Button onClick={handleCrawl} disabled={busy} className='gap-1.5'>
                {busy && <Loader2 className='h-4 w-4 animate-spin' />}
                Cartographier
              </Button>
            </>
          ) : (
            <>
              <Button variant='outline' onClick={() => setPhase('input')} disabled={busy}>Retour</Button>
              <Button onClick={handleAdd} disabled={busy || selected.size === 0} className='gap-1.5'>
                {busy && <Loader2 className='h-4 w-4 animate-spin' />}
                Ajouter ({selected.size})
              </Button>
            </>
          )}
        </DialogFooter>
        {phase === 'tree' && error && <p className='text-sm text-destructive'>{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
