import { useContext, useEffect, useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ThemeProviderContext } from '@/contexts/ThemeContext';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { downloadBlob } from '../../utils/docx-export';
import { exportSlides, SlideExportError, type SlideExportFormat } from './slide-export';
import { fetchSlideExportImage } from '../../api';
import type { OpenUiCitationScope } from './citations';

export function SlideExportMenu({ program, isStreaming, citationScope }: Readonly<{ program: string; isStreaming: boolean; citationScope?: OpenUiCitationScope }>) {
  const { t } = useModuleTranslation('conversation');
  const { theme } = useContext(ThemeProviderContext);
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => { setBusy(false); return () => { request.current?.abort(); request.current = null; }; }, [program]);
  const run = async (format: SlideExportFormat) => {
    if (request.current && !request.current.signal.aborted) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const mode = theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme === 'dark' ? 'dark' : 'light';
      const fallback = citationScope ? (url: string, signal: AbortSignal) => fetchSlideExportImage(citationScope.conversationId, citationScope.messageId, url, signal) : undefined;
      const result = await exportSlides(program, format, mode, controller.signal, fallback);
      if (!controller.signal.aborted) { downloadBlob(result.blob, result.filename); showSuccess(t('openui.slides.export.ready')); }
    } catch (error) {
      if (!controller.signal.aborted) showError(t(`openui.slides.export.${error instanceof SlideExportError ? error.reason : 'failed'}`));
    } finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  };
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant='ghost' size='sm' disabled={isStreaming || busy}>
      {busy ? <Loader2 className='mr-1 size-3.5 animate-spin' /> : <Download className='mr-1 size-3.5' />}
      {t(busy ? 'openui.slides.export.busy' : 'openui.slides.export.label')}
    </Button></DropdownMenuTrigger>
    <DropdownMenuContent align='end'>
      <DropdownMenuLabel className='max-w-64 text-xs font-normal text-muted-foreground'>{t('openui.slides.export.hint')}</DropdownMenuLabel>
      <DropdownMenuItem onSelect={() => void run('pdf')}>{t('openui.slides.export.pdf')}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void run('pptx')}>{t('openui.slides.export.pptx')}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
