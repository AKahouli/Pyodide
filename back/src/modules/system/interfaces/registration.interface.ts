export interface RegistrationStatus {
  enabled: boolean;
  disabledAt?: Date;
  disabledBy?: string;
  classicAuthEnabled?: boolean;
}
