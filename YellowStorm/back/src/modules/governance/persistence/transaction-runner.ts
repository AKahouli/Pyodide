
/**
 * Runs `fn` atomically: every store call made inside joins the same database
 * transaction (stores resolve the ambient transaction). Never perform network
 * or LLM calls inside `fn`.
 */
export interface GovernanceTransactionRunner {
  run<R>(fn: () => Promise<R>): Promise<R>;
}

/** No-op runner (unit tests / default constructor argument): runs `fn` without a transaction. */
export const PASSTHROUGH_TRANSACTION: GovernanceTransactionRunner = { run: (fn) => fn() };
