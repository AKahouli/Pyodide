import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, Bot, Crown, Loader2, Network, Settings2, Users } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { getTeamById } from '@/modules/team/api';
import type { Team, TeamWithAgents } from '@/modules/team/types';
import type { Agent } from '../../types';
import type { LibraryItem } from './library-model';
import { useLibrary } from './LibraryContext';

export function LibraryPreview({ item, onClose, agents, teams, onEditAgent, onEditTeam, onShareTeam, onDeleteTeam, onLeaveTeam }: {
  item: LibraryItem | null; onClose: () => void; agents: Agent[]; teams: Team[];
  onEditAgent: (agent: Agent) => void; onEditTeam: (team: Team) => void;
  onShareTeam: (team: Team) => void; onDeleteTeam: (team: Team) => void; onLeaveTeam: (team: Team) => void;
}) {
  const { t } = useModuleTranslation('agent');
  const { t: tt } = useModuleTranslation('team');
  const navigate = useNavigate();
  const library = useLibrary()!;
  const [detail, setDetail] = useState<TeamWithAgents | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setDetail(null); setError(false);
    if (item?.kind !== 'team') return;
    let active = true;
    getTeamById(item.value.id).then(value => { if (active) setDetail(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [item?.kind, item?.value.id, retry]);
  const team = item?.kind === 'team' ? item.value : null;
  const related = item?.kind === 'agent' ? teams.filter(team => team.members?.some(m => m.agentId === item.value.id)) : [];
  const memberList = detail?.members ?? [];
  return <Sheet open={!!item} onOpenChange={open => { if (!open) onClose(); }}>
    <SheetContent className='flex w-full flex-col p-0 sm:max-w-xl motion-reduce:transition-none motion-reduce:animate-none' closeLabel={t('library.close')}>
      {item && <>
        <SheetHeader className='shrink-0 px-7 pb-6 pt-10 text-left'>
          <span className='mb-3 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary'>{team ? <Network /> : <Bot />}</span>
          <SheetTitle className='line-clamp-2 break-words pr-6 text-2xl leading-tight'>{item.value.name}</SheetTitle>

        </SheetHeader>
        <div className='min-h-0 flex-1 space-y-7 overflow-y-auto break-words border-t px-7 py-6'>
          <SheetDescription className='text-base leading-7'>{item.value.description || (team ? t('library.teamFallback') : t('library.agentFallback'))}</SheetDescription>
          <div className='flex flex-wrap gap-3 text-sm text-muted-foreground'><span>{t(team ? 'library.team' : 'library.agent')}</span><span>·</span><span>{t(item.value.isActive ? 'card.active' : 'card.inactive')}</span><span>·</span><span>{t(item.value.shareInfo ? 'hub.sections.shared' : item.kind === 'agent' && item.value.isDefault ? 'hub.sections.defaults' : 'hub.sections.personal')}</span></div>
          {team ? <section>
            <h3 className='mb-4 flex items-center gap-2 text-base font-semibold'><Users className='size-4' />{t('library.members')}</h3>
            {!detail && !error && <p role='status' className='flex items-center gap-2 text-sm'><Loader2 className='size-4 animate-spin' />{t('library.loading')}</p>}
            {error && <div role='alert'><p className='mb-2 text-sm'>{t('library.membersError')}</p><Button variant='outline' size='sm' onClick={() => setRetry(v => v + 1)}>{t('library.retry')}</Button></div>}
            <ul className='divide-y'>{memberList.map(member => {
              const agent = member.agent ?? agents.find(a => a.id === member.agentId);
              return <li key={member.agentId} className='flex gap-3 py-4'><span className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted'>{member.parentAgentId === null ? <Crown className='size-4 text-primary' /> : <Bot className='size-4' />}</span><div className='min-w-0'><p className='font-medium'>{agent?.name ?? t('library.unavailableMember')}</p><p className='mt-1 text-sm leading-6 text-muted-foreground'>{agent?.description || t(member.parentAgentId === null ? 'library.coordinator' : 'library.specialist')}</p></div></li>;
            })}</ul>
            {detail && memberList.length === 0 && <p className='text-sm text-muted-foreground'>{t('library.noMembers')}</p>}
            <Button variant='outline' className='mt-4' onClick={() => navigate(`/teams/${team.id}`)}><Network className='mr-2 size-4' />{t('library.structure')}</Button>
          </section> : <section><h3 className='mb-3 font-semibold'>{t('library.about')}</h3><p className='whitespace-pre-line text-sm leading-7 text-muted-foreground'>{(item.kind === 'agent' ? item.value.role : '') || t('library.agentFallback')}</p></section>}
          {related.length > 0 && <section><h3 className='mb-3 font-semibold'>{t('library.partOf')}</h3>{related.map(value => <Button key={value.id} variant='outline' className='mr-2 mb-2' onClick={() => library.preview({ kind: 'team', value })}><Users className='mr-2 size-4' />{value.name}</Button>)}</section>}
          <section><h3 className='font-semibold'>{t('library.starters')}</h3><p className='mb-3 mt-1 text-sm text-muted-foreground'>{t('library.draftHint')}</p>
            {(['help', 'review', 'plan'] as const).map(key => <button key={key} disabled={!item.value.isActive || !!team && !team.agentCount} className='flex w-full items-center justify-between gap-3 border-b py-3 text-left text-sm hover:text-primary focus-visible:outline focus-visible:outline-ring disabled:opacity-50' onClick={() => library.start(item, t(`library.prompt.${key}`))}>{t(`library.starter.${key}`)}<ArrowUpRight className='size-4 shrink-0' /></button>)}
          </section>
          <details className='border-t pt-4'><summary className='cursor-pointer text-sm font-medium'>{t('library.manage')}</summary><div className='mt-3 flex flex-wrap gap-2'>
            {team ? <>{(!team.shareInfo || team.shareInfo.permission === 'write') && <Button variant='outline' size='sm' onClick={() => { onClose(); onEditTeam(team); }}>{tt('card.edit')}</Button>}{!team.shareInfo && <><Button variant='outline' size='sm' onClick={() => { onClose(); onShareTeam(team); }}>{tt('card.shareTeam')}</Button><Button variant='ghost' size='sm' className='text-destructive' onClick={() => { onClose(); onDeleteTeam(team); }}>{tt('card.delete')}</Button></>}{team.shareInfo && <Button variant='outline' size='sm' onClick={() => onLeaveTeam(team)}>{tt('card.removeShared')}</Button>}</> : <Button variant='outline' size='sm' onClick={() => { onClose(); onEditAgent(item.value as Agent); }}><Settings2 className='mr-2 size-4' />{t('card.viewSettings')}</Button>}
          </div></details>
        </div>
        <footer className='shrink-0 border-t px-7 py-5'><Button className='w-full' disabled={!item.value.isActive || !!team && !team.agentCount} onClick={() => library.start(item)}>{t('library.start')}</Button><p className='mt-2 text-center text-xs text-muted-foreground'>{t('library.startHint')}</p></footer>
      </>}
    </SheetContent>
  </Sheet>;
}
