import { IsArray, ArrayMinSize, ArrayMaxSize, IsEmail } from 'class-validator';

export class CloneSharePlaybookDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsEmail({}, { each: true })
  emails!: string[];
}
