import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Loader2, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useWorkspaceStore } from '../store';
import { crawlUrl } from '../api';
import { useBrowserSession, normalizeUrl, type CollectedPage } from '../hooks/useBrowserSession';
import { readAutoIndexationValue } from '../hooks/useAutoIndexation';
import { readDeepSearchIndexationValue } from '../hooks/useDeepSearchIndexation';
import { BrowserSessionViewer } from './BrowserSessionViewer';
import { CollectionSidebar } from './CollectionSidebar';

function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

/** Move a selection entry from oldUrl to newUrl (no-op if oldUrl wasn't selected). */
export function migrateSelection(selected: Set<string>, oldUrl: string, newUrl: string): Set<string> {
  if (!selected.has(oldUrl)) return selected;
  const next = new Set(selected);
  next.delete(oldUrl);
  next.add(newUrl);
  return next;
}

export function AddLinkDialog({
  open, onOpenChange, workspaceId, initialUrl = '', autoStart = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  initialUrl?: string;
  autoStart?: boolean;
}) {
  const addPageLinks = useWorkspaceStore((s) => s.addPageLinks);
  const seed = useWorkspaceStore((s) => s.addLinkDialog.seed);
  const session = useBrowserSession();

  const [phase, setPhase] = useState<'input' | 'browse'>('input');
  const [url, setUrl] = useState(initialUrl);
  const [addressBar, setAddressBar] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exploring, setExploring] = useState<Set<string>>(new Set());

  const indexedUrls = useMemo(() => new Set(seed.map((s) => normalizeUrl(s.url))), [seed]);

  useEffect(() => {
    if (open) {
      if (autoStart && isValidUrl(initialUrl)) {
        // Opened from an existing group: skip the input step and browse the
        // root URL directly so the user can index more pages immediately.
        setUrl(initialUrl); setError(null); setBusy(false); setSelected(new Set());
        session.start(
          initialUrl.trim(),
          seed.map((s) => ({
            url: s.url,
            title: '',
            linkText: s.name,
            indexingStatus: s.indexingStatus as CollectedPage['indexingStatus'],
          })),
        );
        setPhase('browse');
      } else {
        // An already-active session (e.g. carried over from a prior open) should
        // drop the user straight into the browse phase instead of forcing a
        // redundant "input" step.
        setPhase(session.status === 'idle' ? 'input' : 'browse');
        setUrl(initialUrl); setError(null); setBusy(false); setSelected(new Set());
      }
    } else {
      session.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialUrl]);

  // Auto-select each newly collected page (never the already-indexed seed).
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      session.pages.forEach((p) => { if (!indexedUrls.has(normalizeUrl(p.url))) next.add(p.url); });
      return next;
    });
  }, [session.pages, indexedUrls]);

  useEffect(() => { if (session.currentUrl) setAddressBar(session.currentUrl); }, [session.currentUrl]);

  const handleStart = () => {
    setError(null);
    if (!isValidUrl(url)) { setError('Veuillez saisir une URL valide (http:// ou https://).'); return; }
    session.start(url.trim());
    setPhase('browse');
  };

  const toggle = (u: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(u) ? n.delete(u) : n.add(u); return n; });
  const remove = (u: string) =>
    setSelected((prev) => { const n = new Set(prev); n.delete(u); return n; });
  const selectableUrls = () => session.pages.map((p) => p.url).filter((u) => !indexedUrls.has(normalizeUrl(u)));
  const selectAll = () => setSelected(new Set(selectableUrls()));
  const selectNone = () => setSelected(new Set());

  const chosen = session.pages
    .map((p) => p.url)
    .filter((u) => selected.has(u) && !indexedUrls.has(normalizeUrl(u)));

  const handleExplore = async (exploreUrl: string) => {
    setExploring((p) => new Set(p).add(exploreUrl));
    try {
      const { pages, truncated } = await crawlUrl(workspaceId, exploreUrl);
      const added = session.addPages(pages.map((p) => ({ url: p.url, title: p.title ?? '' })));
      toast.success(added === 0 ? 'Aucune nouvelle page trouvée.' : `${added} page(s) trouvée(s)${truncated ? ' (limite atteinte)' : ''}`);
    } catch {
      toast.error("L'exploration a échoué.");
    } finally {
      setExploring((p) => { const n = new Set(p); n.delete(exploreUrl); return n; });
    }
  };

  const handleIndex = async () => {
    if (busy || chosen.length === 0) return;
    setBusy(true);
    try {
      // Carry each page's display name (the clicked link/button text, same as the
      // sidebar) so indexed docs are named after the link rather than the URL.
      const names: Record<string, string> = {};
      for (const page of session.pages) {
        if (!chosen.includes(page.url)) continue;
        const name = (page.linkText || page.title || '').replace(/\s+/g, ' ').trim();
        if (name) names[page.url] = name;
      }
      // Every link indexed in this session shares the session's start URL as its
      // group root — including manually-added links on other domains (grouping is
      // the user's responsibility). No per-link self-rooting.
      await addPageLinks(workspaceId, chosen, {
        deepSearch: readDeepSearchIndexationValue(),
        autoIndex: readAutoIndexationValue(),
        sourceRootUrl: session.rootUrl ?? undefined,
        names,
      });
      toast.success(`${chosen.length} page(s) ajoutée(s) · conversion en cours`);
      onOpenChange(false);
    } catch {
      setError("Une erreur est survenue lors de l'ajout. Réessayez.");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        className={phase === 'browse' ? 'flex h-[92vh] w-[80vw] max-w-[96vw] flex-col gap-3 overflow-hidden' : undefined}
      >
        <DialogHeader className={phase === 'browse' ? 'shrink-0' : undefined}>
          <DialogTitle>Ajouter un lien</DialogTitle>
          <DialogDescription>
            {phase === 'input'
              ? "Naviguez sur le site et collectez les pages à indexer."
              : 'Naviguez ; les pages visitées sont collectées à droite. Sélectionnez celles à indexer.'}
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
              onKeyDown={(e) => { if (e.key === 'Enter') handleStart(); }}
              autoFocus
            />
            {error && <p className='text-sm text-destructive'>{error}</p>}
          </div>
        ) : (
          <div className='grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[1fr_520px]'>
            <div className='flex min-h-0 min-w-0 flex-col rounded border'>
              <div className='flex shrink-0 items-center gap-1 border-b px-2 py-1.5'>
                <Button size='icon' variant='ghost' className='h-7 w-7' onClick={() => session.navigate({ kind: 'back' })}><ArrowLeft className='h-4 w-4' /></Button>
                <Button size='icon' variant='ghost' className='h-7 w-7' onClick={() => session.navigate({ kind: 'forward' })}><ArrowRight className='h-4 w-4' /></Button>
                <Button size='icon' variant='ghost' className='h-7 w-7' onClick={() => session.navigate({ kind: 'reload' })}><RotateCw className='h-4 w-4' /></Button>
                <Input
                  value={addressBar}
                  onChange={(e) => setAddressBar(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && isValidUrl(addressBar)) session.navigate({ kind: 'goto', url: addressBar.trim() }); }}
                  className='h-7 text-xs'
                />
              </div>
              <div className='relative min-h-0 flex-1 overflow-hidden bg-muted/10'>
                {session.status === 'busy' ? (
                  <div className='flex h-full items-center justify-center text-sm text-muted-foreground'>Navigateur occupé. Réessayez dans un instant.</div>
                ) : session.status === 'connecting' ? (
                  <div className='flex h-full items-center justify-center'><Loader2 className='h-6 w-6 animate-spin' /></div>
                ) : (
                  <BrowserSessionViewer frame={session.frame} onInput={session.sendInput} />
                )}
                {session.blockedNotice && (
                  <div className='absolute inset-x-0 bottom-0 bg-destructive/90 px-3 py-1.5 text-xs text-destructive-foreground'>
                    {session.blockedNotice}
                  </div>
                )}
              </div>
            </div>
            <CollectionSidebar
              pages={session.pages}
              selected={selected}
              indexedUrls={indexedUrls}
              onToggle={toggle}
              onDelete={remove}
              onSelectAll={selectAll}
              onSelectNone={selectNone}
              onAdd={(url, name) => session.addManualPage(url, name)}
              onEdit={(oldUrl, patch) => {
                const ok = session.updatePage(oldUrl, patch);
                if (ok && patch.url && patch.url !== oldUrl) {
                  setSelected((prev) => migrateSelection(prev, oldUrl, patch.url as string));
                }
                return ok;
              }}
              onExplore={handleExplore}
              exploring={exploring}
            />
          </div>
        )}

        <DialogFooter>
          {phase === 'input' ? (
            <>
              <Button variant='outline' onClick={() => onOpenChange(false)}>Annuler</Button>
              <Button onClick={handleStart}>Naviguer</Button>
            </>
          ) : (
            <>
              <Button variant='outline' onClick={() => { session.stop(); setPhase('input'); }} disabled={busy}>Retour</Button>
              <Button onClick={handleIndex} disabled={busy || chosen.length === 0} className='gap-1.5'>
                {busy && <Loader2 className='h-4 w-4 animate-spin' />}
                Indexer ({chosen.length})
              </Button>
            </>
          )}
        </DialogFooter>
        {phase === 'browse' && error && <p className='text-sm text-destructive'>{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
