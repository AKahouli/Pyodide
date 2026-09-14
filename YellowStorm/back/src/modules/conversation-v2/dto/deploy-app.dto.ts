import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DeployAppDto {
  @ApiPropertyOptional({ description: 'Application title shown in the App Marketplace' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({
    description:
      'Finalized workspace revision to deploy (e.g. rev_15). Defaults to the latest finalized version.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  revisionId?: string;
}
