import { useState } from 'react';
import { Ban, Bookmark, Bot, Copy, Eye, Globe, LogOut, MoreHorizontal, Pencil, Share2, Trash2, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { Agent } from '../../types';
import { useModuleTranslation } from '@/modules/localization';
import { usePermissions } from '@/modules/admin';
import { AgentMemoriesModal } from '../AgentMemoriesModal';
import { useLibrary } from './LibraryContext';
import { itemKey } from './library-model';

interface AgentCardRichProps {
  agent: Agent; layout?: 'grid' | 'list';
  onEdit?: (agent: Agent) => void; onDelete?: (agent: Agent) => void;
  onView?: (agent: Agent) => void; onDuplicate?: (agent: Agent) => void;
  onPublishA2A?: (agent: Agent) => void; onRevokeA2A?: (agent: Agent) => void;
  onShare?: (agent: Agent) => void; onUnshare?: (agent: Agent) => void;
  publishingA2A?: boolean;
}
export function AgentCardRich({ agent, layout = 'grid', onEdit, onDelete, onView, onDuplicate, onPublishA2A, onRevokeA2A, onShare, onUnshare, publishingA2A }: AgentCardRichProps) {
  const { t } = useModuleTranslation('agent');
  const { hasPermission } = usePermissions();
  const library = useLibrary();
  const [memoriesOpen, setMemoriesOpen] = useState(false);
  const owned = !agent.isDefault && !agent.shareInfo;
  const canEdit = owned || agent.isDefault && hasPermission('agents.update') || agent.shareInfo?.permission === 'write';
  const canDelete = owned || agent.isDefault && hasPermission('agents.delete');
  const canA2A = owned || agent.isDefault && hasPermission('agents.update');
  const actionable = !!(onEdit || onView);
  const item = { kind: 'agent' as const, value: agent };
  const saved = library?.saved.includes(itemKey(item));
  const open = () => canEdit ? onEdit?.(agent) : onView?.(agent);
  const list = layout === 'list';
  return <>
    <article onClick={actionable ? e => { if (!(e.target as HTMLElement).closest('button, [role="menuitem"]')) open(); } : undefined} className={cn('group relative flex h-full gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/50', actionable && 'cursor-pointer', list ? 'flex-wrap items-center sm:flex-nowrap' : 'flex-col')}>
      <div className={cn('flex items-center gap-3', !list && 'justify-between')}>
        <span className='flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground'><Bot className='size-5' /></span>
        {!list && <span className='mr-auto text-xs font-medium text-muted-foreground'>{t('library.agent')}</span>}
        {!list && library && actionable && <Button variant='ghost' size='icon' className='size-9' aria-pressed={saved} aria-label={t(saved ? 'library.unsave' : 'library.save', { name: agent.name })} onClick={e => { e.stopPropagation(); library.toggleSaved(item); }}><Bookmark className={cn('size-4', saved && 'fill-primary text-primary')} /></Button>}
      </div>
      <div className={cn('min-w-0 flex-1', !list && 'min-h-24')}>
        <button disabled={!actionable} className='text-left text-base font-semibold leading-6 tracking-tight hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:text-foreground' onClick={e => { e.stopPropagation(); open(); }}>{agent.name}</button>
        <p className={cn('mt-2 text-sm leading-6 text-muted-foreground', list ? 'line-clamp-1' : 'line-clamp-2')}>{agent.description || t('library.agentFallback')}</p>
        {agent.shareInfo && <p className='mt-2 text-xs text-muted-foreground'>{t('card.sharedBy', { name: agent.shareInfo.sharedBy.firstName || agent.shareInfo.sharedBy.email })}</p>}
      </div>
      <div className={cn('flex items-center justify-between gap-2', !list && 'mt-auto border-t pt-4', list && 'w-full sm:w-auto')}>
        <span className='mr-2 flex items-center gap-1.5 text-xs text-muted-foreground'><span aria-hidden className={cn('size-1.5 rounded-full', agent.isActive ? 'bg-emerald-600' : 'bg-muted-foreground')} />{t(agent.isActive ? 'card.active' : 'card.inactive')}</span>
        {actionable && <div className={cn('flex items-center gap-1 rounded-lg border bg-card/95 p-1 shadow-md backdrop-blur-sm', !list && 'absolute bottom-3 right-3 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100')}>
          {library && <Button variant='ghost' size='sm' disabled={!agent.isActive} onClick={() => library.start(item)}>{t('library.start')}</Button>}
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant='ghost' size='icon' className='size-9' aria-label={t('library.actions', { name: agent.name })}><MoreHorizontal className='size-4' /></Button></DropdownMenuTrigger><DropdownMenuContent align='end'>
            <DropdownMenuItem onSelect={open}><Eye className='mr-2 size-4' />{t('library.details')}</DropdownMenuItem>
            {library && <DropdownMenuItem onSelect={() => library.toggleSaved(item)}><Bookmark className='mr-2 size-4' />{t(saved ? 'library.removeSaved' : 'library.addSaved')}</DropdownMenuItem>}
            {canEdit && onEdit && <DropdownMenuItem onSelect={() => onEdit(agent)}><Pencil className='mr-2 size-4' />{t('createEdit.titleEdit')}</DropdownMenuItem>}
            {!canEdit && onView && <DropdownMenuItem onSelect={() => onView(agent)}><Eye className='mr-2 size-4' />{t('card.viewSettings')}</DropdownMenuItem>}
            {agent.hasSmartMemory && <DropdownMenuItem onSelect={() => setMemoriesOpen(true)}><Database className='mr-2 size-4' />{t('library.memories')}</DropdownMenuItem>}
            {owned && onDuplicate && <DropdownMenuItem onSelect={() => onDuplicate(agent)}><Copy className='mr-2 size-4' />{t('card.duplicate')}</DropdownMenuItem>}
            {owned && onShare && <DropdownMenuItem onSelect={() => onShare(agent)}><Share2 className='mr-2 size-4' />{t('share.shareAgent')}</DropdownMenuItem>}
            {canA2A && onPublishA2A && <DropdownMenuItem disabled={publishingA2A} onSelect={() => onPublishA2A(agent)}><Globe className='mr-2 size-4' />{t(agent.a2aPublished ? 'a2a.rotateKey' : 'a2a.publish')}</DropdownMenuItem>}
            {canA2A && agent.a2aPublished && onRevokeA2A && <DropdownMenuItem disabled={publishingA2A} onSelect={() => onRevokeA2A(agent)}><Ban className='mr-2 size-4' />{t('a2a.revoke')}</DropdownMenuItem>}
            {canDelete && onDelete && <><DropdownMenuSeparator /><DropdownMenuItem className='text-destructive focus:text-destructive' onSelect={() => onDelete(agent)}><Trash2 className='mr-2 size-4' />{t('list.deleteDialog.title')}</DropdownMenuItem></>}
            {agent.shareInfo && onUnshare && <DropdownMenuItem onSelect={() => onUnshare(agent)}><LogOut className='mr-2 size-4' />{t('share.leaveShared')}</DropdownMenuItem>}
          </DropdownMenuContent></DropdownMenu>
        </div>}
      </div>
    </article>
    <AgentMemoriesModal agent={agent} open={memoriesOpen} onOpenChange={setMemoriesOpen} canDelete={!!canEdit} />
  </>;
}
