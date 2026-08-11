import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsString } from 'class-validator';

export class CreateEvaluationBaselineFromExecutionDto {
  @ApiProperty()
  @IsMongoId()
  executionId!: string;
}

export class CreateEvaluationBaselineFromCurrentExecutionDto {
  @ApiProperty()
  @IsMongoId()
  executionId!: string;

  @ApiProperty()
  @IsString()
  evaluationExecutionId!: string;
}
