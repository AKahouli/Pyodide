import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { RootProducerEvidenceDto } from './root-producer-evidence.dto';

export class RootEvidenceManifestDto {
  @IsInt() @Min(1) @Max(1000) count!: number;
  @Matches(/^[0-9a-f]{64}$/) digest!: string;
}

export class SettleRootDelegateDto {
  @ApiProperty({ enum: ['waiting', 'completed', 'failed', 'outcome_unknown'] })
  @IsIn(['waiting', 'completed', 'failed', 'outcome_unknown'])
  status!: 'waiting' | 'completed' | 'failed' | 'outcome_unknown';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(8000) text?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(262144) fullText?: string;
  @ApiPropertyOptional({ type: [RootProducerEvidenceDto] })
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true })
  @Type(() => RootProducerEvidenceDto) evidence?: RootProducerEvidenceDto[];
  @IsOptional() @ValidateNested() @Type(() => RootEvidenceManifestDto) evidenceManifest?: RootEvidenceManifestDto;
}
