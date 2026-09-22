type Identity = { id: string; type: 'agent' | 'member' | 'team' };
type Named = { id: string; name: string };

export function resolveMentions(text: string, tracked: Map<string, Identity>, agents: (Named & { isActive: boolean })[], teams: Named[], members: Named[] = []) {
  const candidates = new Map<string, Identity>();
  for (const member of members) candidates.set(member.name, { id: member.id, type: 'member' });
  for (const agent of agents.filter(agent => agent.isActive)) candidates.set(agent.name, { id: agent.id, type: 'agent' });
  for (const team of teams) candidates.set(team.name, { id: team.id, type: 'team' });
  for (const [name, identity] of tracked) candidates.set(name, identity);
  const ids = { agent: new Set<string>(), member: new Set<string>(), team: new Set<string>() };
  // Longest names consume their mention before a shorter name can match its prefix.
  for (const [name, identity] of [...candidates].sort(([a], [b]) => b.length - a.length)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|\\s)@${escaped}(?=$|[^\\p{L}\\p{N}_-])`, 'gu');
    text = text.replace(pattern, (_match, prefix: string) => {
      ids[identity.type].add(identity.id);
      return prefix;
    });
  }
  return { agentIds: [...ids.agent], memberIds: [...ids.member], teamIds: [...ids.team] };
}
