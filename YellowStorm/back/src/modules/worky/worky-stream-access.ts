import { Types } from 'mongoose';

export type WorkyStreamAccess = 'owner' | 'write' | 'read' | null;

interface StreamAccessShape {
  ownerUserId: Types.ObjectId | string;
  shares?: Array<{ userId: Types.ObjectId | string; permission: 'read' | 'write' }>;
}

export function getWorkyStreamAccess(
  stream: StreamAccessShape,
  userId: string,
): WorkyStreamAccess {
  if (stream.ownerUserId.toString() === userId) return 'owner';
  return stream.shares?.find((share) => share.userId.toString() === userId)?.permission ?? null;
}

export function canWriteWorkyStream(stream: StreamAccessShape, userId: string): boolean {
  const access = getWorkyStreamAccess(stream, userId);
  return access === 'owner' || access === 'write';
}
