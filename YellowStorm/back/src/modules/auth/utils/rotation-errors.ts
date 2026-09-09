/**
 * Internal control-flow signal: the conditional predecessor update found the
 * session already consumed, so the whole rotation transaction must abort.
 */
export class RotationConflictError extends Error {
  constructor() {
    super('Rotation predecessor already consumed');
    this.name = 'RotationConflictError';
  }
}

/**
 * MongoDB topologies without replica-set support reject multi-document
 * transactions. Atomic rotation is the primary path; a deployment that
 * explicitly accepts standalone MongoDB uses the ordered single-document
 * fallback instead.
 */
export function isUnsupportedTransactionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as { name?: string; message?: string };
  if (candidate.name === 'MongoTransactionError' || candidate.name === 'MongoCompatibilityError') {
    return true;
  }
  const message = candidate.message ?? '';
  return message.includes('Transaction numbers are only allowed on a replica set member or mongos');
}

/** Mongo duplicate-key write error (E11000) — used by the unique successor link index. */
export function isDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as { name?: string; code?: number; message?: string };
  if (candidate.code === 11000 || candidate.code === 11001) {
    return true;
  }
  return candidate.name === 'MongoServerError' && (candidate.message ?? '').includes('E11000');
}
