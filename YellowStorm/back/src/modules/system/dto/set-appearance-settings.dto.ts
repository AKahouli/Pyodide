import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsObject, IsString, ValidateNested } from 'class-validator';
import type { ColorTheme } from '../interfaces/appearance.interface';

export class AppearanceThemeConfigDto {
  @ApiProperty()
  @IsString()
  labelKey!: string;

  @ApiProperty({ description: 'Builtin or custom logo id' })
  @IsString()
  logo!: string;
}

export class AppearanceThemesDto {
  @ApiProperty({ type: AppearanceThemeConfigDto })
  @ValidateNested()
  @Type(() => AppearanceThemeConfigDto)
  default!: AppearanceThemeConfigDto;

  @ApiProperty({ type: AppearanceThemeConfigDto })
  @ValidateNested()
  @Type(() => AppearanceThemeConfigDto)
  yellow!: AppearanceThemeConfigDto;

  @ApiProperty({ type: AppearanceThemeConfigDto })
  @ValidateNested()
  @Type(() => AppearanceThemeConfigDto)
  orange!: AppearanceThemeConfigDto;

  @ApiProperty({ type: AppearanceThemeConfigDto })
  @ValidateNested()
  @Type(() => AppearanceThemeConfigDto)
  blue!: AppearanceThemeConfigDto;
}

export class SetAppearanceSettingsDto {
  @ApiProperty({ enum: ['default', 'yellow', 'orange', 'blue'] })
  @IsIn(['default', 'yellow', 'orange', 'blue'])
  defaultColorTheme!: ColorTheme;

  @ApiProperty({ type: AppearanceThemesDto })
  @IsObject()
  @ValidateNested()
  @Type(() => AppearanceThemesDto)
  themes!: AppearanceThemesDto;
}
