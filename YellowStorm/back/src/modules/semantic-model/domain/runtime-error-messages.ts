/**
 * What the semantic runtime's refusals mean, in words a person can act on. The runtime answers with short
 * codes (`no_data_in_use`) or, for a malformed request, FastAPI's list of field errors; both are turned
 * into a sentence here so the app never shows a bare "request failed".
 */
const RUNTIME_ERROR_MESSAGES: Record<string, string> = {
  // Requests
  active_binding_changed: 'The data in use changed while this was loading. Reload and try again.',
  active_binding_not_found: 'This model has no data yet. Run it to read its sources.',
  no_draft_data: 'This model has no data yet. Run it to read its sources.',
  draft_data_outdated: 'The data in use is older than the model. Run the model again.',
  model_not_published: 'This model is not published yet.',
  invalid_record_filters: 'These filters cannot be used.',
  invalid_read_scope: 'This page of records cannot be read.',
  query_too_slow: 'The query took too long. Narrow it and try again.',
  index_unavailable: 'The search index is not ready yet. Try again in a moment.',
  jobs_unavailable: 'The data processing queue is not available right now. Try again in a moment.',
  population_store_unavailable: 'The data store is not available right now. Try again in a moment.',
  population_running: 'A run of this model is already under way. Wait for it to finish.',
  model_jobs_running: 'A run or an index job is still under way for this model. Wait for it to finish.',
  runtime_writes_disabled: 'Changes to the data are turned off on this server.',
  spec_hash_mismatch: 'The model changed while the run was starting. Run again.',
  stale_correction_sequence: 'Someone fixed a value meanwhile. Reload and try again.',
  stale_active_binding: 'The data in use changed meanwhile. Reload and try again.',
  stale_revision_watermark: 'A newer data fix exists. Run the model again.',
  unknown_concept: 'A source points to a concept that no longer exists.',
  unknown_relation: 'A link rule points to a link that no longer exists.',
  revision_not_found: 'This version of the data no longer exists.',
  // Runs
  no_data_in_use: 'Run the whole model once before refreshing a single concept: there is no data to keep yet.',
  invalid_sources: 'The run has no source it can read.',
  invalid_relation_bindings: 'A link matches records on a field no source fills. Open Review to fix it.',
  invalid_derivations: 'A concept filled from another concept is set up wrongly. Open it in Review.',
  invalid_document_mapping: 'A document source is set up wrongly. Open it in Review.',
  invalid_column_mapping: 'A spreadsheet source is set up wrongly. Open it in Review.',
  unmapped_identity: 'A concept has no identifying field mapped.',
  workspace_forbidden: 'You no longer have access to one of the workspaces.',
  workspace_required: 'Connect a workspace to this model first.',
  execution_fingerprint_mismatch: 'The model changed while the run was starting. Run again.',
  attempts_exhausted: 'The run failed several times in a row and was given up. Try again later.',
};

/** FastAPI's validation errors: [{ loc: ['body', 'payload', 'sources'], msg: '...' }]. */
function fieldErrors(detail: unknown[]): string | null {
  const parts = detail.slice(0, 3).map((item) => {
    const entry = item as { loc?: unknown; msg?: unknown };
    const where = Array.isArray(entry.loc) ? entry.loc.filter((part) => part !== 'body').join(' › ') : '';
    const what = typeof entry.msg === 'string' ? entry.msg.replace(/^Value error, /, '') : '';
    return [where, what].filter(Boolean).join(': ');
  }).filter(Boolean);
  return parts.length ? `The semantic runtime refused the request (${parts.join('; ')}).` : null;
}

/** A sentence for a runtime answer: its code in words, its field errors, or its own text. */
export function runtimeErrorMessage(payload: unknown, fallback: string): string {
  const detail = (payload as { detail?: unknown } | null | undefined)?.detail ?? payload;
  if (Array.isArray(detail)) return fieldErrors(detail) ?? fallback;
  const code = typeof detail === 'string' ? detail.trim()
    : typeof (detail as { errorCode?: unknown } | null)?.errorCode === 'string' ? (detail as { errorCode: string }).errorCode : '';
  if (!code) return fallback;
  if (RUNTIME_ERROR_MESSAGES[code]) return RUNTIME_ERROR_MESSAGES[code];
  // A sentence already, or an unknown code shown as words with the code kept for support.
  return /\s/.test(code) ? code.slice(0, 300) : `${fallback} (${code})`;
}

/** Why a call never got an answer: the runtime is down or restarting, or it took too long. */
export function runtimeUnreachableMessage(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError'
    ? 'The semantic runtime did not answer in time. Try again in a moment.'
    : 'The semantic runtime cannot be reached right now (it may be restarting). Try again in a moment.';
}
