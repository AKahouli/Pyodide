import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsMongoId, ArrayMinSize } from 'class-validator';

export class BulkDeleteDocumentsDto {
  @ApiProperty({
    description: 'Array of document IDs to delete',
    example: ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012'],
  })
  @IsArray()
  @IsMongoId({ each: true })
  @ArrayMinSize(1)
  documentIds!: string[];
}
