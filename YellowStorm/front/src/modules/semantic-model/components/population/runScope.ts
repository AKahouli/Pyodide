/**
 * The concepts a concept refresh makes again: the concept itself and every concept made from it, down the chain.
 * The others stay as they are in the data in use, so they are neither read nor shown as refreshing.
 */
export function conceptsRefreshedWith(conceptId: string, derived: ReadonlyArray<{ conceptId: string; sourceConceptId: string }>): string[] {
  const refreshed = new Set([conceptId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const source of derived) {
      if (refreshed.has(source.sourceConceptId) && !refreshed.has(source.conceptId)) {
        refreshed.add(source.conceptId);
        grew = true;
      }
    }
  }
  return [...refreshed];
}
