import { ChevronDown, Download, FileText, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { PORT_COLORS } from '../utils/port-colors';
import { getSafeArtifactUrl } from '../utils/safe-artifact-url';
import { getArtifactDisplayContent, getArtifactPreviewContent } from '../utils/artifact-content';
import type { TaskArtifact, ArtifactKind } from '../types';

function getContentPreview(artifact: TaskArtifact): string | null {
  return getArtifactPreviewContent(artifact);
}

function ArtifactRow({
  artifact,
  onInspect,
}: {
  artifact: TaskArtifact;
  onInspect?: () => void;
}) {
  const { t } = useModuleTranslation('playbook');
  const colors = PORT_COLORS[artifact.artifactKind];
  const Icon = colors?.icon || FileText;

  const handleDownload = () => {
    const safeUrl = getSafeArtifactUrl(artifact.url);
    const content = getArtifactDisplayContent(artifact);
    if (!safeUrl && !content) return;
    if (typeof content === 'string') {
      const blob = new Blob([content], { type: artifact.mimeType || 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = artifact.filename || `artifact-${artifact.portId}`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (safeUrl) {
      const a = document.createElement('a');
      a.href = safeUrl;
      a.download = artifact.filename || `artifact-${artifact.portId}`;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.click();
    }
  };

  const contentPreview = getContentPreview(artifact);
  const hasDownload = !!(getSafeArtifactUrl(artifact.url) || artifact.content || artifact.metadata?.data);
  const kindLabel = t(`artifactKind.${artifact.artifactKind}`);

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/20 p-3 text-sm">
      <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md', colors?.bg || 'bg-muted')}>
        <Icon className={cn('h-4 w-4', colors?.dot.replace('bg-', 'text-') || 'text-muted-foreground')} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{artifact.filename || t('artifacts.unnamed' as any)}</span>
          <span className="shrink-0 rounded-full border border-muted-foreground/20 bg-muted/50 px-1.5 py-0 text-[10px] text-muted-foreground">
            {kindLabel}
          </span>
        </div>
        {artifact.size != null && (
          <span className="text-xs text-muted-foreground">{(artifact.size / 1024).toFixed(1)} KB</span>
        )}
        {contentPreview && !artifact.url && (
          <p className="mt-1 max-h-20 overflow-y-auto rounded bg-muted/50 p-2 font-mono text-xs text-muted-foreground whitespace-pre-wrap break-words">
            {contentPreview}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onInspect && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onInspect}>
            <Search className="mr-1 h-3 w-3" />
            {t('artifacts.view' as any)}
          </Button>
        )}
        {hasDownload && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={handleDownload}>
            <Download className="mr-1 h-3 w-3" />
            {t('artifacts.download' as any)}
          </Button>
        )}
      </div>
    </div>
  );
}

interface PortArtifactPaneProps {
  portId: string;
  portName: string;
  portKind: ArtifactKind;
  artifacts: TaskArtifact[];
  defaultOpen?: boolean;
  onInspectArtifact?: (artifact: TaskArtifact) => void;
}

export function PortArtifactPane({
  portId,
  portName,
  portKind,
  artifacts,
  defaultOpen = false,
  onInspectArtifact,
}: PortArtifactPaneProps) {
  const colors = PORT_COLORS[portKind];
  const PortIcon = colors?.icon || FileText;
  const displayName = portName || portId;

  return (
    <Collapsible defaultOpen={defaultOpen} className="rounded-lg border bg-muted/10">
      <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-2.5 hover:bg-muted/20">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded', colors?.bg || 'bg-muted')}>
            <PortIcon className={cn('h-3.5 w-3.5', colors?.dot.replace('bg-', 'text-') || 'text-muted-foreground')} />
          </div>
          <span className="text-sm font-medium truncate">{displayName}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{artifacts.length}</span>
        </div>
        <ChevronDown className="collapsible-chevron h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 px-4 pb-3">
        {artifacts.map((artifact, idx) => (
          <ArtifactRow
            key={artifact.filename || artifact.url || idx}
            artifact={artifact}
            onInspect={onInspectArtifact ? () => onInspectArtifact(artifact) : undefined}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
