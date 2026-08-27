import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsIn, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ShareSemanticModelEntryDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: ['viewer', 'editor'] })
  @IsIn(['viewer', 'editor'])
  role!: 'viewer' | 'editor';
}

export class ShareSemanticModelDto {
  @ApiProperty({ type: [ShareSemanticModelEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShareSemanticModelEntryDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  shares!: ShareSemanticModelEntryDto[];
}

export class UpdateSemanticModelShareDto {
  @ApiProperty({ enum: ['viewer', 'editor'] })
  @IsIn(['viewer', 'editor'])
  role!: 'viewer' | 'editor';
}
