/** User item counts exclude fan-out coordinators and result preparation. */
export function rootResultCounts(members: Array<{ role: string; status: string }>) {
  const items = members.filter((member) => ['library_worker', 'temporary_worker'].includes(member.role));
  return { requested: items.length, completed: items.filter((item) => item.status === 'completed').length,
    failed: items.filter((item) => item.status === 'failed').length,
    cancelled: items.filter((item) => item.status === 'cancelled').length,
    outcome_unknown: items.filter((item) => item.status === 'outcome_unknown').length,
    not_started: items.filter((item) => item.status === 'not_started').length };
}
