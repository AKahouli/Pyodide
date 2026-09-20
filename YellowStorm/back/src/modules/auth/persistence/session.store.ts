/** Flat row shape of identity.sessions (step 1A). */
export interface SessionRecord {
  id: string;
  userId: string;
  refreshTokenHash: string;
  deviceInfo: Record<string, unknown>;
  ipAddress: string;
  isValid: boolean;
  expiresAt: Date;
  lastActivityAt: Date | null;
  tokenFamily: string;
  rotatedFromSessionId: string | null;
  rotatedToSessionId: string | null;
  rotationAttemptId: string | null;
  rotatedAt: Date | null;
  rotationReceiptExpiresAt: Date | null;
  rotationReceiptCiphertext: string | null;
  rotationReceiptKeyId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewSession {
  userId: string;
  refreshTokenHash: string;
  deviceInfo: Record<string, unknown>;
  ipAddress: string;
  expiresAt: Date;
  tokenFamily: string;
  lastActivityAt?: Date;
  rotatedFromSessionId?: string;
}

/** Predecessor bookkeeping written by a committed rotation. */
export interface RotationBookkeeping {
  rotatedAt: Date;
  rotationAttemptId?: string;
  receipt?: {
    expiresAt: Date;
    keyId: string;
    ciphertext: string;
  };
}

/** Thrown by rotateAtomic when the predecessor was already consumed. */
export class RotationConflictError extends Error {
  constructor() {
    super('rotation predecessor already consumed');
  }
}

export const SESSION_STORE = Symbol('SESSION_STORE');

export interface SessionStore {
  create(init: NewSession): Promise<SessionRecord>;
  findById(id: string): Promise<SessionRecord | null>;
  /** Active (valid, unexpired) sessions for a user, newest activity first. */
  findActiveByUserId(userId: string): Promise<SessionRecord[]>;
  /** Whether this (user, ip) pair has any prior session (new-location check). */
  existsForUserAndIp(userId: string, ipAddress: string): Promise<boolean>;
  invalidateById(id: string): Promise<void>;
  /** Invalidates only when the session still belongs to userId; false when unmatched. */
  invalidateByIdAndUser(userId: string, sessionId: string): Promise<boolean>;
  invalidateAllForUser(userId: string): Promise<void>;
  invalidateByFamily(tokenFamily: string): Promise<void>;
  deleteById(id: string): Promise<void>;
  countActiveForUser(userId: string): Promise<number>;
  /** Oldest still-valid sessions (max-sessions cap). */
  findOldestActive(userId: string, limit: number): Promise<SessionRecord[]>;
  /**
   * One transaction: claim the predecessor (`is_valid` conditional), insert the
   * successor, write the predecessor bookkeeping. Throws RotationConflictError
   * when the predecessor was concurrently consumed or a successor already
   * exists (unique rotated_from link).
   */
  rotateAtomic(params: {
    predecessorId: string;
    newSession: NewSession;
    bookkeeping: RotationBookkeeping;
  }): Promise<SessionRecord>;
}
