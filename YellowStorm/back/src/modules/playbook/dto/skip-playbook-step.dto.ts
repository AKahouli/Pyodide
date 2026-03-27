import { IsMongoId, IsString } from 'class-validator';

export class SkipPlaybookStepDto {
  @IsMongoId()
  executionId!: string;

  @IsString()
  taskId!: string;
}
