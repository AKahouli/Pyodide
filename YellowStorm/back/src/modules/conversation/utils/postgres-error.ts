interface PostgresErrorLike {
  code?: unknown;
  constraint?: unknown;
}

export function isMessageRequestIdentityConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as PostgresErrorLike;
  return candidate.code === '23505' && candidate.constraint === 'uq_messages_request_identity';
}
