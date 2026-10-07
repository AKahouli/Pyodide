import type {
  RuntimeGraphExpandResult,
  RuntimeGraphSearchResult,
  RuntimeRecordsQueryResult,
} from '../services/semantic-runtime-client.service';

/**
 * Why an answer may leave records out. A record the user may not see never makes an answer incomplete
 * (it is not theirs to see), it is counted apart in hiddenRecords.
 */
export type IncompleteReason =
  | 'more_results'      // more records match than were returned (a limit or a page)
  | 'index_not_ready'   // the search index is being built: only exact keys and names were searched
  | 'index_partial'     // some records are not in the search index
  | 'values_unreadable' // some values could not be read with the field's type and were left out
  | 'values_cut';       // some long values were cut

/** The same block on every read tool's answer, so the assistant can say plainly whether it has everything. */
export interface AnswerCompleteness {
  /** Every record the user may see that answers this call is in the result. */
  complete: boolean;
  returned: number;
  /** The exact number of matching records, when it is known. */
  total: number | null;
  hasMore: boolean;
  /** Records left out because the user may not see them (not counted, not shown). */
  hiddenRecords: number;
  reasons: IncompleteReason[];
  dataRevisionId: string;
}

function block(input: Omit<AnswerCompleteness, 'complete'>): AnswerCompleteness {
  return { complete: input.reasons.length === 0, ...input };
}

/** find_records: ranked candidates, so the total is unknown; complete when nothing was cut and the index covers the data. */
export function findCompleteness(result: RuntimeGraphSearchResult): AnswerCompleteness {
  const reasons: IncompleteReason[] = [];
  if (result.hasMore) reasons.push('more_results');
  if (result.index.state !== 'ready') {
    reasons.push('index_not_ready');
  } else {
    const searched = result.coverage.indexedCount + result.coverage.exactOnlyCount;
    if (result.coverage.expectedCount && searched < result.coverage.expectedCount) reasons.push('index_partial');
  }
  return block({
    returned: result.seeds.length, total: null, hasMore: Boolean(result.hasMore),
    hiddenRecords: result.hiddenRecords ?? 0, reasons, dataRevisionId: result.dataRevisionId,
  });
}

/** get_related_records: the walk can stop at max_records; the exact count of linked records says how many exist. */
export function relatedCompleteness(result: RuntimeGraphExpandResult, oneStep: boolean): AnswerCompleteness {
  const linked = result.nodes.filter((node) => node.inclusionReason === 'relationship');
  const counts = result.linkCounts ?? [];
  // For one step the stored links of the seeds give the exact total (already scoped to the concepts asked for).
  const total = oneStep && result.linkCounts ? counts.reduce((sum, count) => sum + count.count, 0) : null;
  const hidden = counts.reduce((sum, count) => sum + count.hidden, 0) + result.hiddenSeeds;
  const cut = result.nodes.some((node) => node.truncatedFields?.length);
  const hasMore = result.truncated || (total !== null && linked.length < total);
  const reasons: IncompleteReason[] = [];
  if (hasMore) reasons.push('more_results');
  if (cut) reasons.push('values_cut');
  return block({ returned: linked.length, total, hasMore, hiddenRecords: hidden, reasons, dataRevisionId: result.dataRevisionId });
}

/** query_records: exact totals; complete when the page or groups hold everything and every value could be read. */
export function queryCompleteness(result: RuntimeRecordsQueryResult): AnswerCompleteness {
  const grouped = Boolean(result.buckets);
  const hasMore = grouped ? Boolean(result.bucketsTruncated) : result.nextOffset !== null && result.nextOffset !== undefined;
  const reasons: IncompleteReason[] = [];
  if (hasMore) reasons.push('more_results');
  if (Object.values(result.unparsable ?? {}).some((count) => count > 0)) reasons.push('values_unreadable');
  if (result.records?.some((record) => record.truncated)) reasons.push('values_cut');
  return block({
    returned: grouped ? result.buckets?.length ?? 0 : result.records?.length ?? 0,
    total: result.total ?? null, hasMore, hiddenRecords: result.hiddenRecords ?? 0, reasons,
    dataRevisionId: result.dataRevisionId,
  });
}
