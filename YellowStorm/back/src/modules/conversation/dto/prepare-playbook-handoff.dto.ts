import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsMongoId, IsObject, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

export class PreparePlaybookHandoffDto {
  @ApiProperty({ enum: [1] })
  @IsInt()
  @Min(1)
  @Max(1)
  contractVersion!: 1;

  @ApiProperty()
  @IsMongoId()
  targetMessageId!: string;

  @ApiProperty({ type: Object, additionalProperties: { type: 'string' } })
  @IsObject()
  activeBranches!: Record<string, string>;

  @ApiProperty()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  branchSelectionFingerprint!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^(original|corrected|abstention|attempt:[A-Za-z0-9._-]{1,128})$/)
  displayedAnswerVersion!: 'original' | 'corrected' | 'abstention' | `attempt:${string}`;

  @ApiProperty()
  @IsUUID()
  creationRequestId!: string;
}
