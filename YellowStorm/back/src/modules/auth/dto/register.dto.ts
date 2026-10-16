import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  Matches,
  IsOptional,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({
    description: 'User email address',
    example: 'user@example.com',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @MaxLength(255)
  email!: string;

  @ApiProperty({
    description: 'User password (min 8 chars, must include uppercase, lowercase, and number)',
    example: 'SecurePass123',
    minLength: 8,
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, and one number',
  })
  password!: string;

  /**
   * Super-admin invitation token from the invite link. Optional: registration
   * without an invitation stays exactly as before. When present it must be
   * unused, unexpired, and issued for the same email.
   */
  @ApiPropertyOptional({ description: 'Super-admin invitation token' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  inviteToken?: string;
}
