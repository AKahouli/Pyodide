import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({
    description: 'Email verification token',
    example: 'a1b2c3d4e5f6...',
  })
  @IsString()
  @Length(64, 64, { message: 'Invalid verification token' })
  token!: string;
}
