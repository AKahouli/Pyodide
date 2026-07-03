import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsEmail } from 'class-validator';

export class ShareDeployDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @IsEmail({}, { each: true })
  emails!: string[];
}
