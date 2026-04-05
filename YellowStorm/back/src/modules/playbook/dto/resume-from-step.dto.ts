import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class ResumeFromStepDto {
  @IsString()
  taskId!: string;

  @IsOptional()
  @IsBoolean()
  streaming?: boolean;
}
