import { DeviceInfoData } from './auth.interface';

export interface CreateSessionData {
  userId: string;
  refreshTokenHash: string;
  deviceInfo: DeviceInfoData;
  ipAddress: string;
  expiresAt: Date;
  tokenFamily: string;
}

export interface ISessionDocument {
  _id: string;
  userId: string;
  refreshTokenHash: string;
  deviceInfo: DeviceInfoData;
  ipAddress: string;
  isValid: boolean;
  expiresAt: Date;
  lastActivityAt: Date;
  tokenFamily: string;
  createdAt: Date;
  updatedAt: Date;
}
