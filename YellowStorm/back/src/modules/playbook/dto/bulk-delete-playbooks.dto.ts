import { IsArray, ArrayMinSize, ArrayMaxSize, IsMongoId } from 'class-validator';

export class BulkDeletePlaybooksDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsMongoId({ each: true })
  ids!: string[];
}
