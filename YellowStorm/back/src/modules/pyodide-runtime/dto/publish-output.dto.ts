import { IsString, MaxLength, MinLength } from 'class-validator';

export class PublishPyodideOutputDto {
  /** Exact workspace file name of an execute_python output (logical reference, never a path). */
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;
}
