import { Request } from 'express';
import { UserDocument } from '../../user/schemas/user.schema';

export interface AuthenticatedRequest extends Request {
  user: UserDocument;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}



export interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    emailVerified: boolean;
    profileComplete: boolean;
    profile: {
      firstName?: string;
      lastName?: string;
      company?: string;
    };
    consents: {
      privacyPolicy: boolean;
      privacyPolicyAcceptedAt?: Date;
      dataSharing: boolean;
      dataSharingAcceptedAt?: Date;
    };
    plan?: {
      id: string;
      slug?: string;
      startedAt?: Date;
    };
    status: string;
    permissions: string[];
    roleNames: string[];
  };
}

export interface RegisterResponse {
  message: string;
  userId: string;
}

export interface DeviceInfoData {
  userAgent: string;
  browser?: string;
  browserVersion?: string;
  os?: string;
  osVersion?: string;
  device?: string;
  deviceType?: string;
}

export interface SessionInfo {
  id: string;
  deviceInfo: DeviceInfoData;
  ipAddress: string;
  createdAt: Date;
  lastActivityAt?: Date;
  isCurrent: boolean;
}
