import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class DocumentLifecycleTransitionDto {
  @ApiProperty({ maxLength: 200 }) @IsString() @MaxLength(200) commandId!: string;
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) expectedGovernanceRevision!: number;
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) comment?: string;
}
