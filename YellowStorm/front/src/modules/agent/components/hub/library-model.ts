import type { Agent } from '../../types';
import type { Team } from '@/modules/team/types';

export type LibraryItem = { kind: 'agent'; value: Agent } | { kind: 'team'; value: Team };
export const itemKey = (item: LibraryItem) => `${item.kind}:${item.value.id}`;
export function matchesLibrarySearch(item: LibraryItem, query: string, agents: Agent[] = []) {
  const members = item.kind === 'team' ? agents.filter(a => item.value.members?.some(m => m.agentId === a.id)) : [];
  const text = [item.value.name, item.value.description, item.kind === 'agent' ? item.value.role : '', ...members.map(a => `${a.name} ${a.description}`)]
    .join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  return query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim().split(/\s+/).every(word => text.includes(word));
}
export function readLibraryPreferences(key: string): { saved: string[]; recent: string[] } {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '{}');
    const ids = (list: unknown) => Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string').slice(0, 200) : [];
    return { saved: ids(value?.saved), recent: ids(value?.recent).slice(0, 6) };
  } catch { return { saved: [], recent: [] }; }
}
