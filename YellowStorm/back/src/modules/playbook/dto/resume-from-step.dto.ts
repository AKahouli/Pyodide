import { IsString } from 'class-validator';

export class ResumeFromStepDto {
  @IsString()
  taskId!: string;
}
