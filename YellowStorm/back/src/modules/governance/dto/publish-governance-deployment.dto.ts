import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';

export class PublishGovernanceDeploymentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  revisionId?: string;

  @ApiPropertyOptional({ enum: ['widget', 'whatsapp', 'telegram'], isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(['widget', 'whatsapp', 'telegram'], { each: true })
  channels?: Array<'widget' | 'whatsapp' | 'telegram'>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowPartial?: boolean;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
