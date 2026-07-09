import { useEffect, useState } from 'react';
import { governanceApi } from '@/modules/governance/api';
import type { GovernanceUserSearchResult } from '@/modules/governance/types';

const userCache = new Map<string, GovernanceUserSearchResult | null>();

export function GovernanceUserName({ userId }: Readonly<{ userId: string }>): JSX.Element {
  const [user, setUser] = useState<GovernanceUserSearchResult | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (userCache.has(userId)) {
      setUser(userCache.get(userId) ?? null);
      return () => {
        isMounted = false;
      };
    }
    governanceApi.searchUsers(userId, 5)
      .then((users) => {
        const matchedUser = users.find((item) => item.id === userId) ?? null;
        userCache.set(userId, matchedUser);
        if (isMounted) setUser(matchedUser);
      })
      .catch(() => {
        userCache.set(userId, null);
        if (isMounted) setUser(null);
      });
    return () => {
      isMounted = false;
    };
  }, [userId]);

  if (!user) return <>{userId}</>;

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
  return <>{fullName || user.email}</>;
}
