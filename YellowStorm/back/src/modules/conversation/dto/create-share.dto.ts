import { IsString, IsOptional, IsIn, IsArray, IsEmail, IsInt, Min, Max, MaxLength, ArrayMaxSize } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class CreateShareDto {
  @ApiProperty({ enum: ['public', 'private'] })
  @IsIn(['public', 'private'])
  shareType!: 'public' | 'private';

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: 'Recipient emails (for private shares)', type: [String] })
  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value)
      ? [...new Set(value.map((email: unknown) => String(email).trim().toLowerCase()))]
      : value,
  )
  @IsArray()
  @ArrayMaxSize(20)
  @IsEmail({}, { each: true })
  recipientEmails?: string[];

  @ApiPropertyOptional({ description: 'Expiry in days', minimum: 1, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;
}
