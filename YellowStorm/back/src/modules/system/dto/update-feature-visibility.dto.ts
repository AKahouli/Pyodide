import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import type { FeatureVisibility } from '../interfaces/feature-visibility.interface';

export class UpdateFeatureVisibilityDto implements FeatureVisibility {
  @ApiProperty()
  @IsBoolean()
  conversation!: boolean;

  @ApiProperty()
  @IsBoolean()
  workspace!: boolean;

  @ApiProperty()
  @IsBoolean()
  playbook!: boolean;

  @ApiProperty()
  @IsBoolean()
  governance!: boolean;

  @ApiProperty()
  @IsBoolean()
  appMarketplace!: boolean;

  @ApiProperty()
  @IsBoolean()
  worky!: boolean;

  @ApiProperty()
  @IsBoolean()
  agents!: boolean;

  @ApiProperty()
  @IsBoolean()
  semanticModel!: boolean;

  @ApiProperty()
  @IsBoolean()
  platformCopilot!: boolean;
}
