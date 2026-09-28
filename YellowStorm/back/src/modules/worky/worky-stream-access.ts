export type WorkyStreamAccess = 'owner' | 'write' | 'read' | null;

interface StreamAccessShape {
  ownerUserId: string;
  shares?: Array<{ userId: string; permission: 'read' | 'write' }>;
}

export function getWorkyStreamAccess(
  stream: StreamAccessShape,
  userId: string,
): WorkyStreamAccess {
  if (String(stream.ownerUserId) === userId) return 'owner';
  return stream.shares?.find((share) => String(share.userId) === userId)?.permission ?? null;
}

export function canWriteWorkyStream(stream: StreamAccessShape, userId: string): boolean {
  const access = getWorkyStreamAccess(stream, userId);
  return access === 'owner' || access === 'write';
}
