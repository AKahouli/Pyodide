import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DeployAppDto {
  @ApiPropertyOptional({ description: 'Application title shown in the App Marketplace' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
