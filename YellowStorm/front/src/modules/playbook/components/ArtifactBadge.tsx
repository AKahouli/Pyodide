import { useMemo } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PORT_COLORS } from '../utils/port-colors';
import { useModuleTranslation } from '@/modules/localization';
import type { TaskArtifact } from '../types';
import { cn } from '@/lib/utils';

const BADGE_TONES: Record<string, string> = {
  text: 'border-blue-500/30 bg-blue-100 text-blue-700',
  document: 'border-indigo-500/30 bg-indigo-100 text-indigo-700',
  code: 'border-green-500/30 bg-green-100 text-green-700',
  image: 'border-pink-500/30 bg-pink-100 text-pink-700',
  data: 'border-amber-500/30 bg-amber-100 text-amber-700',
  json: 'border-orange-500/30 bg-orange-100 text-orange-700',
  dashboard: 'border-purple-500/30 bg-purple-100 text-purple-700',
};

export interface ArtifactBadgeProps {
  artifacts: TaskArtifact[];
  maxVisible?: number;
  onClick?: (artifact: TaskArtifact) => void;
}

export function ArtifactBadge({ artifacts, maxVisible = 3, onClick }: ArtifactBadgeProps) {
  const { t } = useModuleTranslation('playbook');

  const visible = useMemo(() => artifacts.slice(0, maxVisible), [artifacts, maxVisible]);
  const overflow = artifacts.length - maxVisible;

  if (artifacts.length === 0) return null;

  const uniqueKinds = [...new Set(artifacts.map((a) => a.artifactKind))];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex flex-wrap items-center gap-1">
          {visible.map((artifact, idx) => {
            const colors = PORT_COLORS[artifact.artifactKind];
            const Icon = colors?.icon;
            const toneClass = BADGE_TONES[artifact.artifactKind] || 'border-muted-foreground/20 bg-muted text-muted-foreground';
            return (
              <span
                key={`${artifact.portId}-${idx}`}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
                  toneClass,
                  onClick && 'cursor-pointer transition-opacity hover:opacity-80',
                )}
                onClick={onClick ? (e) => { e.stopPropagation(); onClick(artifact); } : undefined}
              >
                {Icon && <Icon className="h-2.5 w-2.5" />}
                <span>{t(`artifactKind.${artifact.artifactKind}` as any)}</span>
              </span>
            );
          })}
          {overflow > 0 && (
            <span className="inline-flex items-center rounded-full border border-muted-foreground/20 bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              +{overflow}
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs space-y-1 text-xs">
        <div className="font-medium">{t('artifacts.title' as any)}</div>
        {uniqueKinds.map((kind) => (
          <div key={kind} className="text-muted-foreground">
            {t(`artifactKind.${kind}` as any)}: {artifacts.filter((a) => a.artifactKind === kind).length}
          </div>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}
