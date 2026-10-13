/** Access tokens are signed with the shared secret via JwtModule's default (HS256); verifiers pin it. */
export const JWT_ALGORITHM = 'HS256' as const;
