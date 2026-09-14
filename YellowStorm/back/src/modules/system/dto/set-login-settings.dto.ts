import { IsString, Matches } from 'class-validator';

const EXPIRY_PATTERN = /^\d+[smhd]$/;

export class SetLoginSettingsDto {
  @IsString()
  @Matches(EXPIRY_PATTERN)
  accessExpiry!: string;

  @IsString()
  @Matches(EXPIRY_PATTERN)
  refreshExpiry!: string;
}
