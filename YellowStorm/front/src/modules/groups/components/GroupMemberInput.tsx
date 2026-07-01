import { useCallback, useRef, useState } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { searchUsers } from '../api';
import type { GroupMember, UserSearchResult } from '../types';

interface GroupMemberInputProps {
  members: GroupMember[];
  onAdd: (user: GroupMember) => void;
  onRemove: (userId: string) => void;
  disabled?: boolean;
}

function displayName(u: { firstName?: string; lastName?: string; email: string }) {
  return u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email;
}

export function GroupMemberInput({ members, onAdd, onRemove, disabled }: Readonly<GroupMemberInputProps>) {
  const { t } = useModuleTranslation('groups');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);

  const runSearch = useCallback((value: string) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (value.length < 3) {
      setResults([]);
      setShowResults(false);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    timeoutRef.current = setTimeout(async () => {
      const id = ++requestRef.current;
      try {
        const found = await searchUsers(value);
        if (requestRef.current === id) {
          setResults(found);
          setShowResults(found.length > 0);
        }
      } catch {
        if (requestRef.current === id) {
          setResults([]);
          setShowResults(false);
        }
      } finally {
        if (requestRef.current === id) setIsSearching(false);
      }
    }, 300);
  }, []);

  const handleSelect = (u: UserSearchResult) => {
    if (!members.some((m) => m.id === u.id)) {
      onAdd({ id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName });
    }
    setQuery('');
    setResults([]);
    setShowResults(false);
  };

  return (
    <div className='space-y-2'>
      <div className={cn('relative rounded-md border bg-background px-2 py-1', disabled && 'opacity-50')}>
        <Search className='absolute left-3 top-3 h-4 w-4 text-muted-foreground' />
        <div className='flex flex-wrap items-center gap-2 pl-8 pr-8'>
          {members.map((m) => (
            <div key={m.id} className='flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs font-medium'>
              <span className='max-w-40 truncate'>{displayName(m)}</span>
              <button
                type='button'
                onClick={() => onRemove(m.id)}
                disabled={disabled}
                className='text-muted-foreground hover:text-destructive focus:outline-none'
              >
                <X className='h-3 w-3' />
              </button>
            </div>
          ))}
          <input
            type='text'
            value={query}
            onChange={(e) => { setQuery(e.target.value); runSearch(e.target.value); }}
            placeholder={t('dialog.searchPlaceholder')}
            disabled={disabled}
            className='flex-1 min-w-32 border-0 bg-transparent py-2 text-sm placeholder:text-muted-foreground focus:outline-none'
          />
        </div>
        {isSearching && (
          <div className='absolute right-3 top-3'>
            <Loader2 className='h-4 w-4 animate-spin text-muted-foreground' />
          </div>
        )}
        {showResults && results.length > 0 && (
          <div className='absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-md border bg-background shadow-lg'>
            {results.map((u) => (
              <button
                type='button'
                key={u.id}
                onClick={() => handleSelect(u)}
                className='flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted'
              >
                <div className='flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 font-medium text-primary'>
                  {displayName(u).charAt(0).toUpperCase()}
                </div>
                <div className='flex flex-col'>
                  <span className='text-sm font-medium'>{displayName(u)}</span>
                  <span className='text-xs text-muted-foreground'>{u.email}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {members.length === 0 && <p className='text-xs text-muted-foreground'>{t('dialog.noMembers')}</p>}
    </div>
  );
}
