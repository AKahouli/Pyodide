import { Copy, Eye, Lock, Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Agent } from '../../types';
import { useModuleTranslation } from '@/modules/localization';

type Layout = 'grid' | 'list';

interface AgentCardRichProps {
  agent: Agent;
  layout?: Layout;
  onEdit?: (agent: Agent) => void;
  onDelete?: (agent: Agent) => void;
  onView?: (agent: Agent) => void;
  onDuplicate?: (agent: Agent) => void;
}

function typeColor(typeId: string): string {
  let hash = 0;
  for (let i = 0; i < typeId.length; i++) {
    hash = (hash * 31 + typeId.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash % 5) + 1;
  return `var(--chart-${idx})`;
}

function formatRelative(dateStr: string | undefined, locale: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  const diffSeconds = (date.getTime() - Date.now()) / 1000;
  const abs = Math.abs(diffSeconds);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(diffSeconds), 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSeconds / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSeconds / 3600), 'hour');
  if (abs < 2592000) return rtf.format(Math.round(diffSeconds / 86400), 'day');
  if (abs < 31536000) return rtf.format(Math.round(diffSeconds / 2592000), 'month');
  return rtf.format(Math.round(diffSeconds / 31536000), 'year');
}

function CreativityDots({ value }: { value: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(value * 5)));
  return (
    <span className="inline-flex items-center gap-[3px]" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            i < filled ? 'bg-foreground/70' : 'bg-foreground/15',
          )}
        />
      ))}
    </span>
  );
}

export function AgentCardRich({
  agent,
  layout = 'grid',
  onEdit,
  onDelete,
  onView,
  onDuplicate,
}: AgentCardRichProps) {
  const { t, language } = useModuleTranslation('agent');

  const isDefault = agent.isDefault;
  const isOwned = !isDefault;
  const isReadOnly = isDefault;
  const canEdit = !isDefault;

  const color = typeColor(agent.agentType?.id ?? '');
  const ago = formatRelative(agent.updatedAt, language || 'en');

  const actions = (
    <div
      className={cn(
        'flex items-center gap-0.5 opacity-60 transition group-hover:opacity-100',
        layout === 'list' && 'shrink-0',
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {canEdit && onEdit && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(agent);
          }}
          title={t('createEdit.titleEdit')}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
      {isReadOnly && !isDefault && onView && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => {
            e.stopPropagation();
            onView(agent);
          }}
          title={t('card.viewSettings')}
        >
          <Eye className="h-3.5 w-3.5" />
        </Button>
      )}
      {isOwned && onDuplicate && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate(agent);
          }}
          title={t('card.duplicate')}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      )}
      {isOwned && onDelete && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(agent);
          }}
          title={t('list.deleteDialog.title')}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );

  if (layout === 'list') {
    return (
      <div className="group relative flex items-center gap-4 rounded-lg border border-border/60 bg-card px-4 py-3 transition hover:border-border hover:bg-accent/30">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium tracking-tight">{agent.name}</span>
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
              {agent.agentType?.name ?? t('card.unknownType')}
            </span>
            {isDefault && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
            <span
              className={cn(
                'ml-auto shrink-0 h-1.5 w-1.5 rounded-full',
                agent.isActive ? 'bg-emerald-500' : 'bg-muted-foreground/40',
              )}
              title={agent.isActive ? t('card.active') : t('card.inactive')}
              aria-hidden
            />
          </div>
          {agent.description && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{agent.description}</p>
          )}
          <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
            <CreativityDots value={agent.temperature} />
            {agent.model && (
              <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                {agent.model}
              </span>
            )}
            {ago && <span>{t('card.updated', { ago })}</span>}
          </div>
        </div>
        {actions}
      </div>
    );
  }

  return (
    <div className="group relative flex h-full flex-col rounded-xl border border-border/60 bg-card p-5 transition hover:border-border hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px]">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: color }}
            aria-hidden
          />
          <span className="uppercase tracking-[0.08em] text-muted-foreground">
            {agent.agentType?.name ?? t('card.unknownType')}
          </span>
          {agent.isDefaultForType && (
            <span className="rounded-sm border border-border/80 px-1 py-0 text-[10px] text-muted-foreground">
              {t('card.default')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {isDefault && <Lock className="h-3 w-3 text-muted-foreground" />}
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              agent.isActive ? 'bg-emerald-500' : 'bg-muted-foreground/40',
              agent.isActive && 'shadow-[0_0_0_3px_rgb(16_185_129/0.15)]',
            )}
            title={agent.isActive ? t('card.active') : t('card.inactive')}
            aria-hidden
          />
        </div>
      </div>

      <div className="mt-4">
        <h3 className="text-[15px] font-semibold leading-snug tracking-tight">
          {agent.name}
        </h3>
        {agent.role && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{agent.role}</p>
        )}
      </div>

      {agent.description && (
        <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {agent.description}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5" title={t('card.creativityLabel')}>
          <CreativityDots value={agent.temperature} />
          <span className="tabular-nums">{agent.temperature.toFixed(1)}</span>
        </span>
        {agent.model && (
          <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px]">
            {agent.model}
          </span>
        )}
        {ago && <span>{t('card.updated', { ago })}</span>}
      </div>

      <div className="-mx-5 -mb-5 mt-4 flex items-center justify-end border-t border-border/50 bg-accent/20 px-3 py-2">
        {actions}
      </div>
    </div>
  );
}
