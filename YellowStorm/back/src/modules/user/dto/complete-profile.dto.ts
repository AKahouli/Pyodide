import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsBoolean, MaxLength, MinLength } from 'class-validator';

export class CompleteProfileDto {
  @ApiProperty({ description: 'First name', minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ description: 'Last name', minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @ApiProperty({ description: 'Company name', minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  company!: string;

  @ApiProperty({ description: 'Privacy policy acceptance' })
  @IsBoolean()
  privacyPolicy!: boolean;

  @ApiProperty({ description: 'Data sharing consent' })
  @IsBoolean()
  dataSharing!: boolean;
}
