import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import type { FeatureVisibility } from '../interfaces/feature-visibility.interface';

export class UpdateFeatureVisibilityDto implements Partial<FeatureVisibility> {
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

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  playbookDevtools?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  playbookDeltaAutosave?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  playbookMcpAssistant?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  governedConversations?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  governedScopeCarousel?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  dataRoomDecisionFlows?: boolean;
}
