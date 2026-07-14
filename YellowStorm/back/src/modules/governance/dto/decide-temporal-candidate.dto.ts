import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export class DecideTemporalCandidateDto {
  @ApiProperty({ enum: ['confirm', 'correct', 'reject'] }) @IsIn(['confirm', 'correct', 'reject']) action!: 'confirm' | 'correct' | 'reject';
  @ApiPropertyOptional() @ValidateIf((object: DecideTemporalCandidateDto) => object.action === 'correct') @IsString() correctedValue?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) comment?: string;
}
