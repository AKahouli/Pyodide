import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { NAVIGATION_TARGET_KEYS, type NavigationTargetKey } from '../interfaces/navigation-settings.interface';

export class NavigationLabelsDto {
  @IsString()
  @MaxLength(80)
  en!: string;

  @IsString()
  @MaxLength(80)
  fr!: string;
}

export class NavigationNodeDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,63}$/)
  id!: string;

  @IsIn(['group', 'item'])
  type!: 'group' | 'item';

  @IsDefined()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  parentId!: string | null;

  @IsInt()
  @Min(0)
  position!: number;

  @IsBoolean()
  visible!: boolean;

  @IsObject()
  @ValidateNested()
  @Type(() => NavigationLabelsDto)
  labels!: NavigationLabelsDto;

  @IsOptional()
  @IsIn(NAVIGATION_TARGET_KEYS)
  targetKey?: NavigationTargetKey;
}

export class UpdateNavigationSettingsDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => NavigationNodeDto)
  nodes!: NavigationNodeDto[];
}
