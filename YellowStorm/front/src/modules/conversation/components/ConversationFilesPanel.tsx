import { useEffect, useRef, useState } from 'react';
import { AgentInterface } from '@openuidev/react-ui';
import ReactMarkdown from 'react-markdown';
import { Download, FileText, ImageIcon, LayoutDashboard, Loader2, MessageSquare, Plus, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useApiAction } from '@/lib/use-api-action';
import { useAuth } from '@/modules/auth/useAuth';
import { openFileViewerFromUrlLoader } from '@/modules/file-viewer';
import { useModuleTranslation } from '@/modules/localization';
import { downloadArtifactFile, fetchConversationAssets, fetchMessage, getConversationAssetUrl, type ConversationAsset, type ConversationAssetPage } from '../api';
import { useConversationStore } from '../store';
import { useConversationUiStore } from '../uiStore';
import { OpenUiAnswer } from './openui/OpenUiAnswer';
import { isOpenUiProgram } from './openui/plain-text';

/** Workspace's custom slot reuses OpenUI without introducing a second chat provider. */
export function ConversationFilesPanel({ conversationId }: { conversationId: string }) {
  const { user } = useAuth();
  return <ScopedFilesPanel key={`${user?.id}:${conversationId}`} conversationId={conversationId} actorId={user?.id ?? ''} />;
}

function ScopedFilesPanel({ conversationId, actorId }: { conversationId: string; actorId: string }) {
  const { t } = useModuleTranslation('conversation');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<ConversationAsset['kind'] | ''>('');
  const [page, setPage] = useState<ConversationAssetPage>();
  const [cursor, setCursor] = useState<string>();
  const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [busyRef, setBusyRef] = useState<string>();
  const [preview, setPreview] = useState<{ asset: ConversationAsset; content: string }>();
  const scope = useRef({ active: true });
  const request = useRef(0);
  const messageCount = useConversationStore(state => state.messages.length);
  const streaming = useConversationStore(state => state.isStreaming);
  const revision = useConversationUiStore(state => state.assetListRevision);
  const list = useApiAction(fetchConversationAssets, { showErrorToast: false });
  const resolve = useApiAction(getConversationAssetUrl, { showErrorToast: false });
  const source = useApiAction(fetchMessage, { showErrorToast: false });
  const download = useApiAction(downloadArtifactFile, { showErrorToast: false });

  useEffect(() => {
    const current = scope.current;
    current.active = true;
    return () => { current.active = false; };
  }, []);

  useEffect(() => {
    const id = ++request.current;
    const controller = new AbortController();
    setPage(undefined);
    // Debounce server-side filtering; results always belong to this actor and conversation.
    const timer = setTimeout(() => {
      if (!actorId) return;
      void list.execute(conversationId, { cursor, limit: 20, search: search.trim() || undefined, kind: kind || undefined }, controller.signal)
        .then(result => { if (scope.current.active && id === request.current && result) setPage(result); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [actorId, conversationId, cursor, search, kind, refresh, messageCount, streaming, revision, list.execute]);

  function resetPage() { setCursor(undefined); setCursorHistory([]); }
  async function open(asset: ConversationAsset) {
    setBusyRef(asset.ref);
    if (asset.kind === 'app' && asset.messageId) {
      if (document.getElementById(`message-${asset.messageId}`)) {
        useConversationUiStore.getState().requestOutlineScroll(`message-${asset.messageId}`);
        useConversationUiStore.getState().setContextPanel(null);
      } else {
        const message = await source.execute(conversationId, asset.messageId);
        const component = message?.components?.find(item => item.id === asset.componentId && item.type === 'text')
          ?? message?.components?.find(item => item.type === 'text');
        const content = component && 'content' in component.data ? component.data.content : undefined;
        if (scope.current.active && message) setPreview({ asset: { ...asset, componentId: component?.id }, content: typeof content === 'string' ? content : t('assets.sourceUnavailable') });
      }
    } else {
      const urls = await resolve.execute(conversationId, asset.ref);
      if (scope.current.active && urls) {
        openFileViewerFromUrlLoader(`asset:${actorId}:${conversationId}:${asset.ref}`, asset.name, asset.mimeType ?? 'application/octet-stream', async () => {
          const refreshed = await getConversationAssetUrl(conversationId, asset.ref);
          return { url: refreshed.viewUrl };
        }, { displayMode: 'floating' });
      }
    }
    if (scope.current.active) setBusyRef(undefined);
  }
  async function downloadFile(asset: ConversationAsset) {
    setBusyRef(asset.ref);
    const urls = await resolve.execute(conversationId, asset.ref);
    if (scope.current.active && urls) await download.execute(urls.downloadUrl, asset.name);
    if (scope.current.active) setBusyRef(undefined);
  }
  const error = list.error || resolve.error || source.error || download.error;
  return <AgentInterface.Workspace>
    <section aria-label={t('assets.title')} className='min-w-0 px-3 pb-4'>
      <div className='flex items-center justify-between gap-2 py-3'>
        <h2 className='text-sm font-semibold'>{t('assets.title')}</h2>
        <Button variant='ghost' size='icon' className='size-9 shrink-0' aria-label={t('assets.refresh')} onClick={() => { resetPage(); setRefresh(value => value + 1); }}><RefreshCw className='size-4' /></Button>
      </div>
      <div className='relative'>
        <Search className='pointer-events-none absolute left-2.5 top-3 size-4 text-muted-foreground' aria-hidden />
        <Input className='pl-9' aria-label={t('assets.search')} placeholder={t('assets.search')} value={search} maxLength={200} onChange={event => { resetPage(); setSearch(event.target.value); }} />
      </div>
      <label className='my-3 flex items-center gap-2 text-xs text-muted-foreground'>
        {t('assets.type')}
        <select className='h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring' value={kind} onChange={event => { resetPage(); setKind(event.target.value as typeof kind); }}>
          <option value=''>{t('assets.allTypes')}</option>
          <option value='image'>{t('assets.images')}</option>
          <option value='file'>{t('assets.documents')}</option>
          <option value='app'>{t('assets.apps')}</option>
        </select>
      </label>
      <p className='mb-3 text-xs leading-relaxed text-muted-foreground'>{t('assets.agentHint')}</p>
      {error && <p role='alert' className='my-3 break-words text-sm text-destructive'>{error.message}</p>}
      {page?.sourceErrors?.map(origin => <p role='alert' key={origin} className='my-2 text-sm text-destructive'>{t('assets.sourceError', { source: t(`assets.origin.${origin}`) })}</p>)}
      {!page && !list.error && <p role='status' className='flex items-center gap-2 py-4 text-sm text-muted-foreground'><Loader2 className='size-4 animate-spin motion-reduce:animate-none' />{t('assets.loading')}</p>}
      {page?.assets.length === 0 && <p className='py-5 text-sm text-muted-foreground'>{t(search || kind ? 'assets.noMatches' : 'assets.empty')}</p>}
      {(['upload', 'generated', 'workspace'] as const).map(origin => {
        const assets = page?.assets.filter(asset => asset.origin === origin) ?? [];
        if (!assets.length) return null;
        return <section key={origin} className='mb-5' aria-label={t(`assets.origin.${origin}`)}>
          <h3 className='mb-1 text-xs font-medium text-muted-foreground'>{t(`assets.origin.${origin}`)}</h3>
          <ul className='divide-y'>
            {assets.map(asset => {
              const Icon = asset.kind === 'image' ? ImageIcon : asset.kind === 'app' ? LayoutDashboard : FileText;
              const busy = busyRef === asset.ref;
              return <li key={asset.ref} className='py-3'>
                <div className='flex items-start gap-2'>
                  <Icon className='mt-0.5 size-4 shrink-0 text-muted-foreground' aria-hidden />
                  <div className='min-w-0 flex-1'>
                    <p className='break-words text-sm font-medium'>{asset.name}</p>
                    <p className='mt-1 text-xs text-muted-foreground'>{asset.mimeType?.split('/').at(-1)?.toUpperCase() || t(`assets.kind.${asset.kind}`)}{typeof asset.size === 'number' ? ` · ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(asset.size / 1024)} KB` : ''} · {t(asset.status === 'ready' || asset.status === 'completed' ? 'assets.ready' : 'assets.pending')}</p>
                  </div>
                </div>
                <div className='mt-2 flex flex-wrap gap-1'>
                  {asset.actions.view && <Button variant='outline' size='sm' className='h-8 text-xs' disabled={busy} aria-label={`${t('assets.view')} ${asset.name}`} onClick={() => void open(asset)}>{busy ? <Loader2 className='size-3 animate-spin' /> : null}{t('assets.view')}</Button>}
                  {asset.actions.download && <Button variant='ghost' size='icon' className='size-8' disabled={busy} aria-label={`${t('assets.download')} ${asset.name}`} onClick={() => void downloadFile(asset)}><Download className='size-3.5' /></Button>}
                  {asset.actions.read && <Button variant='ghost' size='sm' className='h-8 text-xs' onClick={() => useConversationUiStore.getState().requestAssetPrompt(actorId, conversationId, asset.ref, asset.name)}><Plus className='size-3' />{t('assets.useInPrompt')}</Button>}
                  {asset.messageId && <Button variant='ghost' size='icon' className='size-8' aria-label={`${t('assets.source')} ${asset.name}`} onClick={() => void open({ ...asset, kind: 'app' })}><MessageSquare className='size-3.5' /></Button>}
                </div>
              </li>;
            })}
          </ul>
        </section>;
      })}
      {page && <nav aria-label={t('assets.pagination')} className='flex items-center justify-between gap-2'>
        <Button size='sm' variant='outline' disabled={!cursorHistory.length || list.isLoading} onClick={() => { setCursor(cursorHistory.at(-1)); setCursorHistory(value => value.slice(0, -1)); }}>{t('assets.previous')}</Button>
        <Button size='sm' variant='outline' disabled={!page.nextCursor || list.isLoading} onClick={() => { setCursorHistory(value => [...value, cursor]); setCursor(page.nextCursor ?? undefined); }}>{t('assets.next')}</Button>
      </nav>}
    </section>
    <Dialog open={Boolean(preview)} onOpenChange={value => { if (!value) setPreview(undefined); }}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-5xl' aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{preview?.asset.name}</DialogTitle></DialogHeader>
        {preview && (isOpenUiProgram(preview.content)
          ? <OpenUiAnswer content={preview.content} isStreaming={false} conversationId={conversationId} messageId={preview.asset.messageId!} partId={preview.asset.componentId} />
          : <div className='prose prose-sm max-w-none break-words dark:prose-invert'><ReactMarkdown>{preview.content}</ReactMarkdown></div>)}
      </DialogContent>
    </Dialog>
  </AgentInterface.Workspace>;
}
