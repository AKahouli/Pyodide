import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useModuleTranslation } from '@/modules/localization';
import { PORT_COLORS } from '../utils/port-colors';
import { getArtifactDisplayContent } from '../utils/artifact-content';
import type { TaskArtifact, ArtifactKind } from '../types';

interface PortContentViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  portName: string;
  portKind: ArtifactKind;
  artifacts: TaskArtifact[];
}

function formatArtifactContent(artifact: TaskArtifact): string {
  const content = getArtifactDisplayContent(artifact);
  if (typeof content === 'string' && content.trim()) return content;
  if (artifact.url) return artifact.url;
  return '';
}

export function PortContentViewer({
  open,
  onOpenChange,
  portName,
  portKind,
  artifacts,
}: PortContentViewerProps) {
  const colors = PORT_COLORS[portKind];
  const PortIcon = colors?.icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {PortIcon && <PortIcon className="h-4 w-4" />}
            <span className="font-mono text-sm">{portName}</span>
            <span className="text-xs font-normal text-muted-foreground">({artifacts.length})</span>
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
          {artifacts.length === 0 && (
            <p className="text-sm text-muted-foreground">No data available for this port.</p>
          )}
          {artifacts.map((artifact, idx) => {
            const content = formatArtifactContent(artifact);
            return (
              <div key={idx} className="rounded-lg border bg-muted/30 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/50">
                  <span className="text-xs font-medium text-muted-foreground">
                    {artifact.filename || artifact.portId}
                  </span>
                  {artifact.mimeType && (
                    <span className="text-[10px] text-muted-foreground/60">{artifact.mimeType}</span>
                  )}
                </div>
                <pre className="p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-60 overflow-y-auto text-muted-foreground">
                  {content || '(empty)'}
                </pre>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
