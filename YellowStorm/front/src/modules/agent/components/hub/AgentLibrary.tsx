import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Bookmark, Bot, CheckSquare, ChevronDown, Clock3, LayoutGrid, List, Loader2, Plus, Search, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { useAuth } from '@/modules/auth/useAuth';
import { usePermissions } from '@/modules/admin/hooks/usePermissions';
import { useModuleTranslation } from '@/modules/localization';
import { useTeamStore, useTeams } from '@/modules/team/store';
import type { Team } from '@/modules/team/types';
import { CreateEditTeamDialog } from '@/modules/team/components/CreateEditTeamDialog';
import { ShareTeamDialog } from '@/modules/team/components/ShareTeamDialog';
import { useAgents, useAgentStore } from '../../store';
import type { Agent } from '../../types';
import type { AgentHubFilteredGroups, UseAgentHubFiltersResult } from '../../hooks/useAgentHubFilters';
import { cn } from '@/lib/utils';
import { LibraryContext } from './LibraryContext';
import { itemKey, matchesLibrarySearch, readLibraryPreferences, type LibraryItem } from './library-model';
import { TeamLibraryCard } from './TeamLibraryCard';
import { LibraryPreview } from './LibraryPreview';

interface Props {
  filters: UseAgentHubFiltersResult; loading: boolean; selectMode: boolean;
  onSelectMode: () => void; onCreate: () => void; onSettings: (agent: Agent) => void;
  bulkBar: ReactNode; children: (groups: AgentHubFilteredGroups) => ReactNode;
}
export function AgentLibrary(props: Props) {
  const { user } = useAuth();
  return <LibraryContent key={user?.id ?? 'anonymous'} {...props} preferenceKey={`agent-library:${user?.id ?? 'anonymous'}`} />;
}
function LibraryContent({ filters, loading, selectMode, onSelectMode, onCreate, onSettings, bulkBar, children, preferenceKey }: Props & { preferenceKey: string }) {
  const { t } = useModuleTranslation('agent');
  const { t: tt } = useModuleTranslation('team');
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const { canSeeMenu, canUseFeature } = usePermissions();
  const canTeams = canSeeMenu('teams');
  const canAgents = canSeeMenu('agents') && canUseFeature('agents');
  const allAgents = useAgents();
  const allTeams = useTeams();
  const agents = canAgents ? allAgents : [];
  const teams = canTeams ? allTeams : [];
  const teamLoading = useTeamStore(s => s.isLoading && !s.isInitialized);
  const teamError = useTeamStore(s => s.error);
  const agentError = useAgentStore(s => s.error);
  const [preferences, setPreferences] = useState(() => readLibraryPreferences(preferenceKey));
  const [preview, setPreview] = useState<LibraryItem | null>(null);
  const [teamDialog, setTeamDialog] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [sharingTeam, setSharingTeam] = useState<Team | null>(null);
  const [deletingTeam, setDeletingTeam] = useState<Team | null>(null);
  const [deleting, setDeleting] = useState(false);
  const requested = params.get('tab') ?? (location.pathname === '/teams' ? 'teams' : 'all');
  const tab = ['all', 'agents', 'teams', 'saved'].includes(requested) ? requested : 'all';
  useEffect(() => { if (canTeams) void useTeamStore.getState().fetchTeams().catch(() => toast.error(t('library.teamLoadError'))); }, [canTeams, t]);
  const updatePreferences = (next: typeof preferences) => {
    setPreferences(next);
    try { localStorage.setItem(preferenceKey, JSON.stringify(next)); }
    catch { toast.error(t('library.saveError')); }
  };
  const toggleSaved = (item: LibraryItem) => {
    const key = itemKey(item);
    updatePreferences({ ...preferences, saved: preferences.saved.includes(key) ? preferences.saved.filter(id => id !== key) : [...preferences.saved, key] });
  };
  const start = (item: LibraryItem, draft = '') => {
    if (!item.value.isActive || item.kind === 'team' && !item.value.agentCount) return;
    updatePreferences({ ...preferences, recent: [itemKey(item), ...preferences.recent.filter(id => id !== itemKey(item))].slice(0, 6) });
    navigate('/', { state: { libraryDraft: { id: item.value.id, name: item.value.name, kind: item.kind, text: draft, key: `${Date.now()}-${itemKey(item)}` } } });
  };
  const changeTab = (value: string, clearFilters = false) => {
    if (selectMode) onSelectMode();
    const next = new URLSearchParams(params);
    next.set('tab', value);
    if (clearFilters) for (const key of ['q', 'type', 'owner', 'sort']) next.delete(key);
    if (location.pathname === '/teams' && canAgents) navigate(`/agents?${next}`);
    else setParams(next, { replace: true });
  };
  const items: LibraryItem[] = useMemo(() => [...teams.map(value => ({ kind: 'team' as const, value })), ...agents.map(value => ({ kind: 'agent' as const, value }))], [allTeams, allAgents, canTeams, canAgents]);
  const recent = preferences.recent.map(key => items.find(item => itemKey(item) === key)).filter((item): item is LibraryItem => !!item).slice(0, 4);
  const visible = items.filter(item => {
    if (tab === 'agents' && item.kind !== 'agent' || tab === 'teams' && item.kind !== 'team') return false;
    if (tab === 'saved' && !preferences.saved.includes(itemKey(item))) return false;
    const owner = item.value.shareInfo ? 'shared' : item.kind === 'agent' && item.value.isDefault ? 'default' : 'mine';
    return (filters.filters.owner === 'all' || filters.filters.owner === owner) && matchesLibrarySearch(item, filters.searchInput, agents);
  }).sort((a, b) => filters.filters.sort === 'name' ? a.value.name.localeCompare(b.value.name) : Date.parse(filters.filters.sort === 'created' ? b.value.createdAt : b.value.updatedAt) - Date.parse(filters.filters.sort === 'created' ? a.value.createdAt : a.value.updatedAt));
  const visibleTeams = visible.filter((item): item is Extract<LibraryItem, { kind: 'team' }> => item.kind === 'team');
  const visibleAgents = visible.filter((item): item is Extract<LibraryItem, { kind: 'agent' }> => item.kind === 'agent').map(item => item.value);
  const groups = { personal: visibleAgents.filter(a => !a.isDefault && !a.shareInfo), defaults: visibleAgents.filter(a => a.isDefault && !a.shareInfo), shared: visibleAgents.filter(a => !!a.shareInfo) };
  const openTeam = (team: Team | null) => { setEditingTeam(team); setTeamDialog(true); };
  const busy = canAgents && loading || canTeams && teamLoading;
  const hasFilters = !!filters.searchInput || filters.filters.owner !== 'all';
  return <LibraryContext.Provider value={{ preview: setPreview, start, toggleSaved, saved: preferences.saved }}>
    <div className='h-full overflow-y-auto bg-background'>
      <div className='mx-auto max-w-[1440px] px-5 py-7 sm:px-9 lg:px-12'>
        <header className='flex flex-wrap items-start justify-between gap-5'>
          <div><h1 className='text-2xl font-semibold tracking-tight'>{t('library.title')}</h1><p className='mt-2 text-sm text-muted-foreground'>{t('library.subtitle')}</p></div>
          <div className='flex items-center gap-2'>{canAgents && <Button variant='ghost' size='sm' onClick={onSelectMode}><CheckSquare className='mr-2 size-4' />{t(selectMode ? 'hub.select.cancel' : 'library.organize')}</Button>}
            <DropdownMenu><DropdownMenuTrigger asChild><Button><Plus className='mr-2 size-4' />{t('library.create')}<ChevronDown className='ml-3 size-4' /></Button></DropdownMenuTrigger><DropdownMenuContent align='end' className='w-72'>
              {canAgents && <DropdownMenuItem onSelect={onCreate} className='items-start gap-3 p-3'><Bot className='mt-1 size-5' /><span><strong className='block'>{t('library.createAgent')}</strong><span className='mt-1 block text-xs text-muted-foreground'>{t('library.createAgentHint')}</span></span></DropdownMenuItem>}
              {canTeams && <DropdownMenuItem onSelect={() => openTeam(null)} className='items-start gap-3 p-3'><Users className='mt-1 size-5' /><span><strong className='block'>{t('library.createTeam')}</strong><span className='mt-1 block text-xs text-muted-foreground'>{t('library.createTeamHint')}</span></span></DropdownMenuItem>}
            </DropdownMenuContent></DropdownMenu>
          </div>
        </header>
        <section className='pb-7 pt-9 sm:pt-11' aria-label={t('library.find')}>
          <h2 className='text-3xl font-semibold tracking-tight sm:text-4xl'>{t('library.find')}</h2>
          <div className='relative mt-5 max-w-3xl'><Search className='pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground' /><Input aria-label={t('library.search')} value={filters.searchInput} onChange={event => filters.setSearchInput(event.target.value)} placeholder={t('library.search')} className='h-14 rounded-xl border-border bg-card pl-12 pr-12 text-base shadow-none' />{filters.searchInput && <Button variant='ghost' size='icon' className='absolute right-2 top-2' aria-label={t('library.clearSearch')} onClick={() => filters.setSearchInput('')}><X className='size-4' /></Button>}</div>
          <p className='mt-3 text-sm text-muted-foreground'>{t('library.searchHint')}</p>
        </section>
        {!hasFilters && tab === 'all' && recent.length > 0 && <section className='mb-7 flex flex-wrap items-center gap-2'><h2 className='mr-2 flex items-center gap-2 text-sm text-muted-foreground'><Clock3 className='size-4' />{t('library.recent')}</h2>{recent.map(item => <Button key={itemKey(item)} variant='outline' size='sm' className='max-w-64' onClick={() => setPreview(item)}>{item.kind === 'team' ? <Users className='mr-2 size-3.5 shrink-0' /> : <Bot className='mr-2 size-3.5 shrink-0' />}<span className='truncate'>{item.value.name}</span></Button>)}</section>}
        <div className='flex flex-wrap items-center justify-between gap-4 border-b pb-3'>
          <div className='flex flex-wrap gap-1' role='group' aria-label={t('library.browse')}>
            {(['all', 'teams', 'agents', 'saved'] as const).filter(key => key !== 'teams' || canTeams).filter(key => key !== 'agents' || canAgents).map(key => <Button key={key} variant='ghost' aria-pressed={tab === key} onClick={() => changeTab(key)} className={cn('gap-2', tab === key && 'bg-primary/10 text-primary hover:bg-primary/15')}>
              {key === 'saved' && <Bookmark className='size-4' />}{t(`library.tab.${key}`)}{key !== 'saved' && <span className='text-xs tabular-nums opacity-70'>{key === 'all' ? items.length : key === 'teams' ? teams.length : agents.length}</span>}
            </Button>)}
          </div>
          <div className='flex flex-wrap items-center gap-3'>
            <select aria-label={t('library.ownership')} value={filters.filters.owner} onChange={e => filters.setOwner(e.target.value as 'all' | 'mine' | 'default' | 'shared')} className='h-9 rounded-md border bg-background px-2 text-sm focus-visible:outline-ring'>{(['all','mine','default','shared'] as const).map(key => <option key={key} value={key}>{t(`library.owner.${key}`)}</option>)}</select>
            <select aria-label={t('hub.sort.label')} value={filters.filters.sort} onChange={e => filters.setSort(e.target.value as 'name' | 'updated' | 'created')} className='h-9 rounded-md border bg-background px-2 text-sm focus-visible:outline-ring'><option value='updated'>{t('hub.sort.updated')}</option><option value='created'>{t('hub.sort.created')}</option><option value='name'>{t('hub.sort.name')}</option></select>
            <div className='flex gap-1'>{(['grid','list'] as const).map(view => <Button key={view} variant='ghost' size='icon' aria-label={t(`hub.view.${view}`)} aria-pressed={filters.filters.view === view} className={cn('size-9', filters.filters.view === view && 'bg-muted')} onClick={() => filters.setView(view)}>{view === 'grid' ? <LayoutGrid className='size-4' /> : <List className='size-4' />}</Button>)}</div>
          </div>
        </div>
        {bulkBar}
        {(canAgents && agentError || canTeams && teamError) && <div role='alert' className='mt-5 flex flex-wrap items-center gap-3 rounded-lg border p-4 text-sm'>{t('library.loadError')}<Button variant='outline' size='sm' onClick={() => { if (canAgents) void useAgentStore.getState().refreshAgents().catch(() => toast.error(t('library.loadError'))); if (canTeams) void useTeamStore.getState().refreshTeams().catch(() => toast.error(t('library.teamLoadError'))); }}>{t('library.retry')}</Button></div>}
        <p className='my-5 text-sm text-muted-foreground' role='status'>{t('library.resultCount', { count: visible.length })}{tab === 'saved' && <span className='ml-2'>· {t('library.savedHint')}</span>}</p>
        {busy ? <div role='status' className='flex items-center justify-center gap-3 py-20'><Loader2 className='size-5 animate-spin' />{t('library.loading')}</div> : <>
          {visibleTeams.length > 0 && <section className='mb-9'><div className='mb-4 flex flex-wrap items-baseline gap-3'><h2 className='text-lg font-semibold'>{t('library.teamsTitle')}</h2><p className='text-sm text-muted-foreground'>{t('library.teamsHint')}</p></div><div className={cn('grid gap-4', filters.filters.view === 'grid' ? 'md:grid-cols-2' : 'grid-cols-1')}>{visibleTeams.map(({ value }) => <TeamLibraryCard key={value.id} team={value} agents={agents} />)}</div></section>}
          {visibleAgents.length > 0 && children(groups)}
          {!visible.length && <div className='py-16 text-center'><Search className='mx-auto mb-4 size-7 text-muted-foreground' /><h2 className='text-xl font-semibold'>{t(tab === 'saved' && !hasFilters ? 'library.emptySaved' : 'library.empty')}</h2><p className='mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground'>{t(tab === 'saved' && !hasFilters ? 'library.emptySavedHint' : 'library.emptyHint')}</p><Button variant='outline' className='mt-5' onClick={() => { filters.clearAll(); if (tab === 'saved') changeTab('all', true); }}>{t(tab === 'saved' ? 'library.browseAll' : 'hub.filters.clear')}</Button></div>}
        </>}
      </div>
    </div>
    <LibraryPreview item={preview} onClose={() => setPreview(null)} agents={agents} teams={teams} onEditAgent={onSettings} onEditTeam={openTeam} onShareTeam={setSharingTeam} onDeleteTeam={setDeletingTeam} onLeaveTeam={team => { void useTeamStore.getState().unshareTeam(team.id).then(() => setPreview(null)).catch(() => toast.error(t('library.actionError'))); }} />
    <CreateEditTeamDialog open={teamDialog} onOpenChange={setTeamDialog} team={editingTeam} onSubmit={async data => { if (editingTeam) await useTeamStore.getState().updateTeam(editingTeam.id, data); else await useTeamStore.getState().createTeam(data); }} />
    {sharingTeam && <ShareTeamDialog open onOpenChange={open => { if (!open) setSharingTeam(null); }} team={sharingTeam} />}
    <AlertDialog open={!!deletingTeam} onOpenChange={open => { if (!open && !deleting) setDeletingTeam(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{tt('page.deleteDialog.title')}</AlertDialogTitle><AlertDialogDescription>{tt('page.deleteDialog.description', { name: deletingTeam?.name })}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={deleting}>{tt('page.deleteDialog.cancel')}</AlertDialogCancel><AlertDialogAction disabled={deleting} className='bg-destructive text-destructive-foreground' onClick={async e => { e.preventDefault(); if (!deletingTeam) return; setDeleting(true); try { await useTeamStore.getState().deleteTeam(deletingTeam.id); setDeletingTeam(null); } catch { toast.error(t('library.actionError')); } finally { setDeleting(false); } }}>{tt('page.deleteDialog.confirm')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </LibraryContext.Provider>;
}
