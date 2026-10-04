import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { RootProducerEvidenceDto } from './root-producer-evidence.dto';

export class SettleRootDelegateDto {
  @ApiProperty({ enum: ['waiting', 'completed', 'failed', 'outcome_unknown'] })
  @IsIn(['waiting', 'completed', 'failed', 'outcome_unknown'])
  status!: 'waiting' | 'completed' | 'failed' | 'outcome_unknown';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(8000) text?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(262144) fullText?: string;
  @ApiPropertyOptional({ type: [RootProducerEvidenceDto] })
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true })
  @Type(() => RootProducerEvidenceDto) evidence?: RootProducerEvidenceDto[];
}
