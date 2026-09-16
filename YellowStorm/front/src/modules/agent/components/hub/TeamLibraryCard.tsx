import { Bookmark, Network, Users, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import type { Team } from '@/modules/team/types';
import type { Agent } from '../../types';
import { useLibrary } from './LibraryContext';
import { itemKey } from './library-model';

export function TeamLibraryCard({ team, agents }: { team: Team; agents: Agent[] }) {
  const { t } = useModuleTranslation('agent');
  const library = useLibrary()!;
  const item = { kind: 'team' as const, value: team };
  const saved = library.saved.includes(itemKey(item));
  const members = team.members?.map(m => agents.find(a => a.id === m.agentId)).filter((a): a is Agent => !!a) ?? [];
  return <article className='flex h-full flex-col rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/50'>
    <div className='flex items-center justify-between gap-3'>
      <div className='flex items-center gap-3'><span className='flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary'><Network className='size-5' /></span><span className='text-sm font-medium'>{t('library.team')} <span className='ml-2 text-muted-foreground'>· {t('library.memberCount', { count: team.agentCount })}</span></span></div>
      <Button variant='ghost' size='icon' aria-pressed={saved} aria-label={t(saved ? 'library.unsave' : 'library.save', { name: team.name })} onClick={() => library.toggleSaved(item)}><Bookmark className={saved ? 'size-4 fill-primary text-primary' : 'size-4'} /></Button>
    </div>
    <button className='mt-5 text-left text-xl font-semibold leading-snug tracking-tight hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring' onClick={() => library.preview(item)}>{team.name}</button>
    <p className='mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground'>{team.description || t('library.teamFallback')}</p>
    <div className='my-5 flex flex-wrap items-center gap-2' aria-label={t('library.members')}>
      {members.slice(0, 3).map(a => <span key={a.id} className='max-w-full truncate rounded-md bg-muted px-2.5 py-1.5 text-xs'>{a.name}</span>)}
      {members.length === 0 && <span className='flex items-center gap-2 text-sm text-muted-foreground'><Users className='size-4' />{t('library.exploreMembers')}</span>}
      {team.agentCount > 3 && <span className='text-xs text-muted-foreground'>+{team.agentCount - 3}</span>}
    </div>
    <div className='mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-4'>
      <Button variant='ghost' className='px-0 hover:bg-transparent hover:text-primary' onClick={() => library.preview(item)}>{t('library.meetTeam')}<ArrowUpRight className='ml-2 size-4' /></Button>
      <Button size='sm' disabled={!team.isActive || !team.agentCount} onClick={() => library.start(item)}>{t('library.start')}</Button>
    </div>
  </article>;
}
