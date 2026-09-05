import { useState } from 'react';
import { Download, Eye, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { showError } from '@/lib/notifications';
import { openFileViewerFromUrl } from '@/modules/file-viewer';
import { useModuleTranslation } from '@/modules/localization';
import { requestPlaybookArtifactAccess } from '../api';

interface Props {
  executionId: string;
  artifactId: string;
  filename: string;
  mimeType?: string;
  card?: boolean;
}

export function PlaybookArtifactActions({ executionId, artifactId, filename, mimeType, card = false }: Readonly<Props>) {
  const { t } = useModuleTranslation('playbook');
  const [loading, setLoading] = useState<'view' | 'download' | null>(null);
  const run = async (action: 'view' | 'download') => {
    if (loading) return;
    setLoading(action);
    try {
      const access = await requestPlaybookArtifactAccess(executionId, artifactId, action);
      if (action === 'view') {
        openFileViewerFromUrl(access.url, filename, mimeType || 'application/octet-stream');
      } else {
        const anchor = document.createElement('a');
        anchor.href = access.url;
        anchor.download = filename;
        anchor.rel = 'noopener';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      }
    } catch {
      showError(t('artifacts.openError' as any));
    } finally {
      setLoading(null);
    }
  };
  const actions = (
    <div className="flex shrink-0 flex-wrap items-center gap-1">
      <Button variant="ghost" size="sm" disabled={Boolean(loading)} onClick={() => void run('view')} aria-label={`${t('artifacts.view' as any)} ${filename}`}>
        {loading === 'view' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Eye className="mr-1 h-3.5 w-3.5" />}
        {t('artifacts.view' as any)}
      </Button>
      <Button variant="ghost" size="sm" disabled={Boolean(loading)} onClick={() => void run('download')} aria-label={`${t('artifacts.download' as any)} ${filename}`}>
        {loading === 'download' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
        {t('artifacts.download' as any)}
      </Button>
    </div>
  );
  if (!card) return actions;
  return (
    <div className="my-2 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10"><FileText className="h-5 w-5 text-primary" /></div>
      <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{filename}</div><div className="text-xs text-muted-foreground">{t('artifacts.generated' as any)}</div></div>
      {actions}
    </div>
  );
}
