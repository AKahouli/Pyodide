import { RegistrationApproval, UserStatus } from '../user.types';

export interface IUserProfile {
  firstName?: string;
  lastName?: string;
  company?: string;
  role?: string;
  description?: string;
}

export interface IUserConsents {
  privacyPolicy: boolean;
  privacyPolicyAcceptedAt?: Date;
  dataSharing: boolean;
  dataSharingAcceptedAt?: Date;
}

export interface IUserPlan {
  id?: string;
  slug?: string;
  startedAt?: Date;
}

export interface IUser {
  id: string;
  email: string;
  emailVerified: boolean;
  profile: IUserProfile;
  consents: IUserConsents;
  profileComplete: boolean;
  microsoftAccountId?: string;
  plan?: IUserPlan;
  status: UserStatus;
  registrationApproval?: RegistrationApproval;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
}

export interface CreateUserData {
  email: string;
  password: string;
  profile?: IUserProfile;
  microsoftAccountId?: string;
  emailVerified?: boolean;
}

export interface UpdateUserData {
  profile?: Partial<IUserProfile>;
  appearance?: {
    colorTheme?: 'default' | 'yellow' | 'orange' | 'blue';
    language?: string;
  };
  consents?: Partial<IUserConsents>;
}

export interface CompleteProfileData {
  firstName: string;
  lastName: string;
  company: string;
  privacyPolicy: boolean;
  dataSharing: boolean;
  role?: string;
  description?: string;
}

export interface UserResponse {
  id: string;
  email: string;
  emailVerified: boolean;
  profileComplete: boolean;
  appearance?: {
    colorTheme: 'default' | 'yellow' | 'orange' | 'blue';
    language: string;
  };
  profile: IUserProfile;
  status: UserStatus;
  consents: IUserConsents;
  plan?: IUserPlan;
  registrationApproval?: RegistrationApproval;
  permissions?: string[];
  roleNames?: string[];
}
