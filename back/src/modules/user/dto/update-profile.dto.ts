import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, MaxLength, MinLength, IsEnum, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export enum ColorThemeDto {
  DEFAULT = 'default',
  YELLOW = 'yellow',
  ORANGE = 'orange',
  BLUE = 'blue',
}

class UpdateAppearanceDto {
  @ApiPropertyOptional({ description: 'Color theme', enum: ColorThemeDto })
  @IsOptional()
  @IsEnum(ColorThemeDto)
  colorTheme?: ColorThemeDto;

  @ApiPropertyOptional({ description: 'User language preference (ISO 639-1 code)' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(5)
  language?: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ description: 'First name', maxLength: 100 })
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ description: 'Last name', maxLength: 100 })
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({ description: 'Company name', maxLength: 200 })
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(200)
  company?: string;

  @ApiPropertyOptional({ description: 'Accept privacy policy' })
  @IsOptional()
  privacyPolicy?: boolean;

  @ApiPropertyOptional({ description: 'Accept data sharing' })
  @IsOptional()
  dataSharing?: boolean;

  @ApiPropertyOptional({ description: 'Appearance preferences' })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateAppearanceDto)
  appearance?: UpdateAppearanceDto;
}
