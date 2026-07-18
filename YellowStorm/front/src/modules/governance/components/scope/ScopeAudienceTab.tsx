import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Search, ShieldCheck, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { parseApiError } from '@/lib/api-error';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { useAuth } from '@/modules/auth';
import { useGroups, useGroupsStore } from '@/modules/groups';
import { governanceApi, useGovernanceScopeAudience, useUpdateGovernanceScopeAudience, type GovernanceUserSearchResult } from '@/modules/governance';
import { ScopeAttentionNotice } from './ScopeAttentionNotice';

interface Props { programId: string; scopeId: string }

export function ScopeAudienceTab({ programId, scopeId }: Readonly<Props>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const { user: currentUser } = useAuth();
  const { data, isLoading } = useGovernanceScopeAudience(programId, scopeId);
  const updateAudience = useUpdateGovernanceScopeAudience(programId, scopeId);
  const groups = useGroups();
  const fetchGroups = useGroupsStore((state) => state.fetchGroups);
  const [mode, setMode] = useState<'all_authenticated' | 'restricted'>('restricted');
  const [users, setUsers] = useState<GovernanceUserSearchResult[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GovernanceUserSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const searchRequestRef = useRef(0);

  useEffect(() => { void fetchGroups().catch(() => undefined); }, [fetchGroups]);
  useEffect(() => {
    if (!data) return;
    setMode(data.mode); setUsers(data.users); setGroupIds(data.groups.map((group) => group.id));
  }, [data]);
  useEffect(() => {
    const requestId = ++searchRequestRef.current;
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setResults([]); setIsSearching(false); setSearchError(false); return;
    }
    setIsSearching(true); setSearchError(false);
    const timer = window.setTimeout(() => {
      void governanceApi.searchUsers(trimmed).then((directoryResults) => {
        if (requestId !== searchRequestRef.current) return;
        const normalized = trimmed.toLowerCase();
        const currentUserText = `${currentUser?.email ?? ''} ${currentUser?.profile.firstName ?? ''} ${currentUser?.profile.lastName ?? ''}`.toLowerCase();
        const selfResult: GovernanceUserSearchResult[] = currentUser && currentUserText.includes(normalized) ? [{ id: currentUser.id, email: currentUser.email, firstName: currentUser.profile.firstName, lastName: currentUser.profile.lastName }] : [];
        setResults([...selfResult, ...directoryResults.filter((candidate) => candidate.id !== currentUser?.id)]);
      }).catch(() => {
        if (requestId !== searchRequestRef.current) return;
        setResults([]); setSearchError(true);
      }).finally(() => {
        if (requestId === searchRequestRef.current) setIsSearching(false);
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [currentUser, query]);

  const selectedUserIds = useMemo(() => new Set(users.map((user) => user.id)), [users]);
  const visibleResults = results.filter((user) => !selectedUserIds.has(user.id));
  const selectedGroups = groups.filter((group) => groupIds.includes(group.id));
  const estimated = new Set([...users.map((user) => user.id), ...selectedGroups.flatMap((group) => group.members.map((member) => member.id))]).size;
  const dirty = data ? (mode !== data.mode || users.map((user) => user.id).sort().join() !== data.users.map((user) => user.id).sort().join() || [...groupIds].sort().join() !== data.groups.map((group) => group.id).sort().join()) : false;

  if (isLoading) return <div role='status' className='flex items-center gap-2 rounded-xl border bg-card p-6 text-sm text-muted-foreground'><Loader2 className='size-4 animate-spin' />{t('scopeShell.audience.loading')}</div>;

  const save = () => updateAudience.mutate({ mode, userIds: mode === 'restricted' ? users.map((user) => user.id) : [], groupIds: mode === 'restricted' ? groupIds : [] }, {
    onSuccess: () => showSuccess(t('scopeShell.audience.saved')),
    onError: (error) => showError(t('scopeShell.audience.saveError'), { description: parseApiError(error).message }),
  });

  return <div className='space-y-5'>
    <section className='rounded-xl border bg-card p-5'>
      <div className='mb-5 flex items-start gap-3'><span className='rounded-lg bg-primary/10 p-2 text-primary'><ShieldCheck className='size-5' /></span><div><h3 className='font-semibold'>{t('scopeShell.audience.title')}</h3><p className='mt-1 max-w-2xl text-sm text-muted-foreground'>{t('scopeShell.audience.description')}</p></div></div>
      <div className='grid gap-3 md:grid-cols-2'>
        {(['all_authenticated', 'restricted'] as const).map((value) => <button key={value} type='button' onClick={() => setMode(value)} className={cn('relative rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', mode === value ? 'border-primary bg-primary/5' : 'hover:bg-muted/40')}>
          {mode === value && <Check className='absolute right-4 top-4 size-4 text-primary' />}
          <div className='font-medium'>{t(`scopeShell.audience.modes.${value}.title`)}</div><div className='mt-1 pr-6 text-sm text-muted-foreground'>{t(`scopeShell.audience.modes.${value}.description`)}</div>
        </button>)}
      </div>
    </section>

    {mode === 'restricted' && <section className='rounded-xl border bg-card p-5'>
      <div className='mb-4'><h3 className='font-semibold'>{t('scopeShell.audience.peopleAndGroups')}</h3><p className='mt-1 text-sm text-muted-foreground'>{t('scopeShell.audience.peopleAndGroupsHelp')}</p></div>
      <div className='relative max-w-xl'><Search className='absolute left-3 top-3 size-4 text-muted-foreground' /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('scopeShell.audience.searchPlaceholder')} className='pl-9' /></div>
      {isSearching && <div role='status' className='mt-2 flex items-center gap-2 text-sm text-muted-foreground'><Loader2 className='size-4 animate-spin' />{t('scopeShell.audience.searching')}</div>}
      {query.trim().length > 0 && query.trim().length < 3 && <p className='mt-2 text-sm text-muted-foreground'>{t('scopeShell.audience.searchMinimum')}</p>}
      {searchError && <ScopeAttentionNotice variant='requirement' className='mt-2'>{t('scopeShell.audience.searchError')}</ScopeAttentionNotice>}
      {!isSearching && !searchError && query.trim().length >= 3 && visibleResults.length === 0 && <p className='mt-2 text-sm text-muted-foreground'>{t('scopeShell.audience.searchNoResults')}</p>}
      {visibleResults.length > 0 && <div className='mt-2 max-w-xl rounded-lg border bg-popover p-1 shadow-sm'>{visibleResults.map((user) => <button type='button' key={user.id} onClick={() => { setUsers((current) => [...current, user]); setQuery(''); setResults([]); }} className='flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted'><span>{[user.firstName, user.lastName].filter(Boolean).join(' ') || user.email}</span><span className='text-xs text-muted-foreground'>{user.email}</span></button>)}</div>}
      <div className='mt-5 grid gap-4 lg:grid-cols-2'>
        <SelectionPanel title={t('scopeShell.audience.people')} empty={t('scopeShell.audience.noPeople')}>{users.map((user) => <SelectionRow key={user.id} label={[user.firstName, user.lastName].filter(Boolean).join(' ') || user.email} detail={user.email} removeLabel={t('access.remove')} onRemove={() => setUsers((current) => current.filter((item) => item.id !== user.id))} />)}</SelectionPanel>
        <SelectionPanel title={t('scopeShell.audience.groups')} empty={t('scopeShell.audience.noGroups')}>{groups.map((group) => <label key={group.id} className='flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 hover:bg-muted/30'><input type='checkbox' checked={groupIds.includes(group.id)} onChange={() => setGroupIds((current) => current.includes(group.id) ? current.filter((id) => id !== group.id) : [...current, group.id])} /><span className='min-w-0 flex-1'><span className='block truncate text-sm font-medium'>{group.name}</span><span className='text-xs text-muted-foreground'>{t('scopeShell.audience.memberCount', { count: group.memberCount })}</span></span></label>)}</SelectionPanel>
      </div>
      {!users.length && !groupIds.length && <ScopeAttentionNotice variant='requirement' className='mt-4'>{t('scopeShell.audience.emptyWarning')}</ScopeAttentionNotice>}
    </section>}

    <section className='flex flex-col gap-4 rounded-xl border bg-card p-5 sm:flex-row sm:items-center sm:justify-between'><div className='flex items-center gap-3'><Users className='size-5 text-primary' /><div><div className='font-medium'>{mode === 'all_authenticated' ? t('scopeShell.audience.summaryEveryone') : t('scopeShell.audience.summaryRestricted', { count: estimated })}</div><div className='text-sm text-muted-foreground'>{t('scopeShell.audience.summaryHelp')}</div></div></div><Button onClick={save} disabled={!dirty || updateAudience.isPending}>{updateAudience.isPending ? t('scopeShell.audience.saving') : t('scopeShell.audience.save')}</Button></section>
  </div>;
}

function SelectionPanel({ title, empty, children }: Readonly<{ title: string; empty: string; children: React.ReactNode }>): JSX.Element { const items = Array.isArray(children) ? children : [children]; return <div><div className='mb-2 text-sm font-medium'>{title}</div><div className='space-y-2'>{items.length && items.some(Boolean) ? children : <div className='rounded-lg border border-dashed p-4 text-sm text-muted-foreground'>{empty}</div>}</div></div>; }
function SelectionRow({ label, detail, removeLabel, onRemove }: Readonly<{ label: string; detail: string; removeLabel: string; onRemove: () => void }>): JSX.Element { return <div className='flex items-center gap-3 rounded-lg border px-3 py-2.5'><span className='min-w-0 flex-1'><span className='block truncate text-sm font-medium'>{label}</span><span className='block truncate text-xs text-muted-foreground'>{detail}</span></span><button type='button' onClick={onRemove} aria-label={`${removeLabel}: ${label}`} className='rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground'><X className='size-4' /></button></div>; }
