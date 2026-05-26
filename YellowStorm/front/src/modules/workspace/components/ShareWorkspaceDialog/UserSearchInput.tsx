/**
 * User Search Input
 * Combobox for searching users by email with permission selector
 */

import { useState, useCallback, useRef } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { UserSearchResult, WorkspacePermission } from '../../types';

interface PendingShare {
  id: string;
  email: string;
  permission: WorkspacePermission;
}

interface UserSearchInputProps {
  pendingShares: PendingShare[];
  onRemovePending: (id: string) => void;
  onAddPending: (share: Omit<PendingShare, 'id'>) => void;
  searchUsers: (query: string) => Promise<UserSearchResult[]>;
  disabled?: boolean;
}

export function UserSearchInput({
  pendingShares,
  onRemovePending,
  onAddPending,
  searchUsers,
  disabled,
}: Readonly<UserSearchInputProps>) {
  const { t } = useModuleTranslation('workspace');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRequestRef = useRef(0);

  const searchUsersCallback = useCallback(
    (query: string) => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      if (query.length < 3) {
        setSearchResults([]);
        setShowResults(false);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      searchTimeoutRef.current = setTimeout(async () => {
        const requestId = ++activeRequestRef.current;
        try {
          const results = await searchUsers(query);
          if (activeRequestRef.current === requestId) {
            setSearchResults(results);
            setShowResults(results.length > 0);
          }
        } catch {
          if (activeRequestRef.current === requestId) {
            setSearchResults([]);
            setShowResults(false);
          }
        } finally {
          if (activeRequestRef.current === requestId) {
            setIsSearching(false);
          }
        }
      }, 300);
    },
    [searchUsers],
  );

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    searchUsersCallback(value);
  };

  const handleSelectUser = (user: UserSearchResult, permission: WorkspacePermission) => {
    onAddPending({ email: user.email, permission });
    setSearchQuery('');
    setSearchResults([]);
    setShowResults(false);
    setIsSearching(false);
  };

  const getDisplayName = (user: UserSearchResult) => {
    if (user.firstName && user.lastName) {
      return `${user.firstName} ${user.lastName}`;
    }
    return user.email;
  };

  return (
    <div className='space-y-2'>
      <div
        className={cn(
          'relative rounded-md border bg-background px-2 py-1 transition focus-within:ring-2 focus-within:ring-ring',
          disabled && 'opacity-50',
        )}
      >
        <Search className='absolute left-3 top-3 h-4 w-4 text-muted-foreground' />
        <div className='flex flex-wrap items-center gap-2 pl-8 pr-8'>
          {pendingShares.map((share) => (
            <div
              key={share.id}
              className='flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs font-medium'
            >
              <span className='max-w-35 truncate'>{share.email}</span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                  share.permission === 'read'
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                    : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
                )}
              >
                {share.permission === 'read'
                  ? t('sharing.permission.readBadge')
                  : t('sharing.permission.readwriteBadge')}
              </span>
              <button
                type='button'
                onClick={() => onRemovePending(share.id)}
                className='text-muted-foreground hover:text-destructive focus:outline-none'
                disabled={disabled}
              >
                <X className='h-3 w-3' />
              </button>
            </div>
          ))}
          <input
            type='text'
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={
              pendingShares.length === 0 ? t('sharing.searchUsers') : t('sharing.invite')
            }
            disabled={disabled}
            className='flex-1 min-w-30 border-0 bg-transparent py-2 text-sm placeholder:text-muted-foreground focus:outline-none'
          />
        </div>
        {isSearching && (
          <div className='absolute right-3 top-3'>
            <Loader2 className='h-4 w-4 animate-spin text-muted-foreground' />
          </div>
        )}
        {showResults && searchResults.length > 0 && (
          <div className='absolute left-0 right-0 top-full z-50 mt-1 bg-background border rounded-md shadow-lg max-h-60 overflow-y-auto'>
            {searchResults.map((user) => (
              <div
                key={user.id}
                className='flex items-center justify-between px-3 py-2 hover:bg-muted transition-colors cursor-pointer'
                onClick={() => handleSelectUser(user, 'read')}
              >
                <div className='flex items-center gap-2'>
                  <div className='h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium'>
                    {getDisplayName(user).charAt(0).toUpperCase()}
                  </div>
                  <div className='flex flex-col'>
                    <span className='text-sm font-medium'>{getDisplayName(user)}</span>
                    <span className='text-xs text-muted-foreground'>{user.email}</span>
                  </div>
                </div>
                <div className='flex gap-1'>
                  <Button
                    variant='ghost'
                    size='sm'
                    type='button'
                    className='h-7 px-2'
                    onClick={(event) => {
                      event.stopPropagation();
                      handleSelectUser(user, 'read');
                    }}
                  >
                    {t('sharing.permission.read')}
                  </Button>
                  <Button
                    variant='ghost'
                    size='sm'
                    type='button'
                    className='h-7 px-2'
                    onClick={(event) => {
                      event.stopPropagation();
                      handleSelectUser(user, 'readwrite');
                    }}
                  >
                    {t('sharing.permission.readwrite')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
