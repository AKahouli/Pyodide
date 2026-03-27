export interface JwtPayload {
  sub: string; // userId
  email: string;
  type: 'access' | 'refresh';
  sessionId: string; // Session ID for immediate revocation support
  permissions: string[]; // Flattened from all roles
  roleNames: string[]; // For display ['admin', 'moderator']
  permissionsVersion: number; // From user.permissionsVersion - used for JWT invalidation
  iat?: number;
  exp?: number;
}

export interface AccessTokenPayload extends JwtPayload {
  type: 'access';
  sessionId: string;
}

export interface RefreshTokenPayload {
  tokenFamily: string;
  sessionId: string;
}
