// Adapted from upstream HtmlView iframe/theme/height lifecycle (MIT). See MINI-APP-NOTICE.txt.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { showError, showSuccess } from '@/lib/notifications';
import { fetchOpenUiAppState } from '../../api';
import { assertMiniAppExportReady, miniAppStateSignature, validateMiniAppSnapshot } from './mini-app-state';
import { registerHtmlCapture, sameHtmlState, type HtmlCapture } from './html-capture';
import type { MiniAppStateIdentity } from './mini-app-state';
import { sanitizeHtmlCapture } from './html-sandbox';
import { htmlDocument, htmlState, type HtmlMode } from './html-sandbox';

export function HtmlViewContent({ html, height, title, value, onChange, writable = false, streaming = false, scheme = 'light', mode = 'strict', identity, name }: {
  identity?: MiniAppStateIdentity; name?: string; html: string; height?: number; title?: string; value?: unknown; onChange: (state: Record<string, unknown>) => void;
  writable?: boolean; streaming?: boolean; scheme?: 'light' | 'dark'; mode?: HtmlMode;
}) {
  const { t } = useModuleTranslation('conversation');
  // Autosave status renders may recreate this object without changing its private scope.
  const captureIdentity = useMemo(() => identity ? { ...identity } : undefined, [identity?.userId, identity?.conversationId, identity?.messageId, identity?.componentId, identity?.programDigest]);
  const frame = useRef<HTMLIFrameElement>(null);
  const port = useRef<MessagePort>();
  const current = useRef({ value, onChange, writable });
  current.current = { value, onChange, writable };
  const pending = useRef<{ id: string; state: Record<string, unknown>; resolve: (capture: HtmlCapture) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const cancelCapture = () => { const request = pending.current; pending.current = undefined; if (request) { clearTimeout(request.timer); request.reject(new Error('HTML view changed during export')); } };
  const [restart, setRestart] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState(false);
  const [measured, setMeasured] = useState(360);
  const [expanded, setExpanded] = useState(false);
  const [source, setSource] = useState(false);
  const [connectedDocument, setConnectedDocument] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const exportLock = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const token = useMemo(() => crypto.randomUUID().replaceAll('-', ''), [html, scheme, restart, mode]);
  const doc = useMemo(() => {
    try { return htmlDocument(html, scheme, token, mode); }
    catch { return null; }
  }, [html, scheme, mode, token]);
  const exportScope = useRef({ identity: captureIdentity, doc, mode, name, connectedDocument, stopped, streaming, error });
  exportScope.current = { identity: captureIdentity, doc, mode, name, connectedDocument, stopped, streaming, error };
  async function exportInteractive() {
    if (exportLock.current || !captureIdentity) return;
    exportLock.current = true; setExporting(true);
    const scope = exportScope.current;
    const assertCurrent = () => {
      const latest = exportScope.current;
      if (!active.current || latest.identity !== scope.identity || latest.doc !== scope.doc || latest.mode !== scope.mode || latest.name !== scope.name
          || latest.stopped || latest.streaming || latest.error || latest.connectedDocument !== scope.doc || !current.current.writable) throw new Error('HTML state changed during export');
    };
    try {
      assertCurrent();
      await assertMiniAppExportReady(captureIdentity, undefined, true);
      const saved = validateMiniAppSnapshot(await fetchOpenUiAppState(captureIdentity), captureIdentity.programDigest);
      if (saved.canWrite === false) throw new Error('Private dashboard access required');
      await assertMiniAppExportReady(captureIdentity, saved, true);
      assertCurrent();
      const state = htmlState(current.current.value ?? {});
      const [{ createStandaloneHtmlExport }, { downloadBlob }, { buildExportFilename }] = await Promise.all([
        import('../../utils/standalone-html-export'), import('../../utils/docx-export'), import('../../utils/document-export'),
      ]);
      const blob = await createStandaloneHtmlExport({ html, state, mode, scheme, title: title || t('openui.html.title'),
        labels: { interactiveWarning: t('openui.html.scriptWarning'), error: t('openui.html.error'), localOnly: t('openui.html.offlineHint') } });
      assertCurrent();
      const acknowledged = validateMiniAppSnapshot(await fetchOpenUiAppState(captureIdentity), captureIdentity.programDigest);
      await assertMiniAppExportReady(captureIdentity, acknowledged, true);
      assertCurrent();
      if (acknowledged.canWrite === false || acknowledged.stateRevision !== saved.stateRevision
          || miniAppStateSignature(acknowledged.state) !== miniAppStateSignature(saved.state) || !sameHtmlState(state, current.current.value)) throw new Error('HTML state changed during export');
      downloadBlob(blob, buildExportFilename(title || t('openui.html.title'), 'html'));
      showSuccess(t('toasts.export.htmlSuccess'));
    } catch (error) {
      if (active.current) showError(t(error instanceof Error && /state|revision|changed/i.test(error.message) ? 'openui.html.exportChanged' : 'openui.html.exportInteractiveError'));
    } finally {
      exportLock.current = false; if (active.current) setExporting(false);
    }
  }
  useEffect(() => setError(false), [doc]);
  const lifecycle = useMemo(() => ({ ready: false, port: undefined as MessagePort | undefined, timer: undefined as ReturnType<typeof setTimeout> | undefined }), [doc, stopped, streaming]);
  const sync = () => {
    try { port.current?.postMessage({ type: 'state', state: htmlState(current.current.value ?? {}), writable: current.current.writable }); }
    catch { setError(true); }
  };
  useEffect(() => { if (pending.current && !sameHtmlState(value, pending.current.state)) cancelCapture(); sync(); }, [value, writable]);
  useEffect(() => {
    if (!captureIdentity || connectedDocument !== doc || stopped || streaming || error || !doc) return;
    const unregister = registerHtmlCapture(captureIdentity, { html, name }, state => new Promise((resolve, reject) => {
      if (!port.current || !sameHtmlState(state, current.current.value)) { reject(new Error('HTML view does not match the saved state')); return; }
      if (pending.current) { reject(new Error('HTML capture already pending')); return; }
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { pending.current = undefined; reject(new Error('HTML capture timed out')); }, 5000);
      pending.current = { id, state, resolve, reject, timer };
      port.current.postMessage({ type: 'capture', id, state });
    }));
    return () => { unregister(); cancelCapture(); };
  }, [captureIdentity, html, name, connectedDocument, doc, stopped, streaming, error]);
  useEffect(() => {
    if (doc && !stopped && !streaming) lifecycle.timer = setTimeout(() => {
      if (!lifecycle.ready) { setError(true); lifecycle.port?.close(); if (port.current === lifecycle.port) port.current = undefined; }
    }, 30000);
    return () => { cancelCapture(); clearTimeout(lifecycle.timer); lifecycle.port?.close(); if (port.current === lifecycle.port) port.current = undefined; };
  }, [doc, stopped, streaming, lifecycle]);
  function connect() {
    if (!frame.current || stopped || streaming || lifecycle.port) return;
    port.current?.close();
    const channel = new MessageChannel(); port.current = channel.port1; lifecycle.port = channel.port1;
    clearTimeout(lifecycle.timer);
    lifecycle.timer = setTimeout(() => { if (!lifecycle.ready) { setError(true); channel.port1.close(); } }, 8000);
    let count = 0, start = Date.now();
    channel.port1.onmessage = event => {
      if (port.current !== channel.port1) return;
      if (Date.now() - start > 1000) { start = Date.now(); count = 0; }
      if (++count > 60) { setError(true); channel.port1.close(); return; }
      try {
        const message: unknown = event.data;
        if (!message || typeof message !== 'object' || !('type' in message)) throw new Error('Invalid HTML message');
        if (message.type === 'capture' && 'id' in message) {
          const request = pending.current;
          if (!request || message.id !== request.id) return;
          pending.current = undefined; clearTimeout(request.timer);
          try {
            if (!('state' in message) || !sameHtmlState(message.state, request.state) || !sameHtmlState(current.current.value, request.state) || !('capture' in message)) throw new Error('HTML capture state changed');
            request.resolve(sanitizeHtmlCapture(message.capture));
          } catch { request.reject(new Error('Invalid HTML capture response')); }
        } else if (message.type === 'ready') { lifecycle.ready = true; setConnectedDocument(doc); clearTimeout(lifecycle.timer); sync(); }
        else if (message.type === 'height' && 'height' in message && typeof message.height === 'number' && Number.isFinite(message.height)) setMeasured(Math.max(80, Math.min(2400, message.height)));
        else if (message.type === 'state' && 'state' in message) {
          cancelCapture();
          if (!current.current.writable) return;
          const next = htmlState(message.state, htmlState(current.current.value ?? {}));
          current.current.onChange(next);
        } else throw new Error('HTML execution failed');
      } catch { setError(true); channel.port1.close(); }
    };
    channel.port1.start();
    frame.current.contentWindow?.postMessage({ type: 'ys-html-init' }, '*', [channel.port2]);
  }
  useEffect(() => {
    if (!doc || stopped || streaming) return;
    const ready = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== 'null' || event.data?.type !== 'ys-html-shell-ready' || event.data.token !== token) return;
      connect();
    };
    window.addEventListener('message', ready);
    frame.current?.contentWindow?.postMessage({ type: 'ys-html-probe', token }, '*');
    return () => window.removeEventListener('message', ready);
  }, [doc, token, lifecycle, stopped, streaming]);
  const unavailable = error || !doc;
  return <section aria-label={title || t('openui.html.title')} aria-busy={!stopped && !unavailable && connectedDocument !== doc} className='min-w-0 space-y-2 rounded-xl border p-3'>
    {mode === 'interactive' && <p className='text-xs text-muted-foreground'>{t('openui.html.scriptWarning')}</p>}
    <div className='flex flex-wrap items-center gap-2'>
      <span className='mr-auto text-sm font-medium'>{title || t('openui.html.title')}</span>
      {captureIdentity && <Button type='button' variant='outline' size='sm' disabled={exporting || stopped || streaming || unavailable || connectedDocument !== doc || !writable} onClick={() => void exportInteractive()}>{t(exporting ? 'openui.html.exporting' : 'openui.html.exportInteractive')}</Button>}
      <Button type='button' variant='ghost' size='sm' onClick={() => setSource(v => !v)}>{t('openui.html.source')}</Button>
      <Button type='button' variant='ghost' size='sm' onClick={() => setExpanded(v => !v)}>{t(expanded ? 'openui.html.collapse' : 'openui.html.expand')}</Button>
      <Button type='button' variant='outline' size='sm' onClick={() => setStopped(true)}>{t('openui.html.stop')}</Button>
      <Button type='button' variant='outline' size='sm' onClick={() => { setError(false); setStopped(false); setRestart(v => v + 1); }}>{t('openui.html.restart')}</Button>
    </div>
    {source && <pre className='max-h-72 overflow-auto whitespace-pre-wrap text-xs'>{html}</pre>}
    {!streaming && !stopped && !unavailable && connectedDocument !== doc && <p role='status'>{t('openui.html.preparing')}</p>}
    {streaming ? <p role='status'>{t('openui.html.preparing')}</p> : unavailable ? <p role='alert'>{t('openui.html.error')}</p> : stopped ? <p role='status'>{t('openui.html.stopped')}</p> :
      <iframe key={doc} ref={frame} title={title || t('openui.html.title')} sandbox='allow-scripts' {...{ credentialless: '' }} referrerPolicy='no-referrer' srcDoc={doc}
        onLoad={() => { frame.current?.contentWindow?.postMessage({ type: 'ys-html-probe', token }, '*'); }}
        className='w-full border-0' style={{ height: expanded ? 1000 : Math.max(80, Math.min(2400, height ?? measured)) }} />}
  </section>;
}
