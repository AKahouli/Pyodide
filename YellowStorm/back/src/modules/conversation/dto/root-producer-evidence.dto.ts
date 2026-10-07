import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsObject, IsString, Max, MaxLength, Min } from 'class-validator';

export class RootProducerEvidenceDto {
  @ApiProperty({ enum: ['citation', 'artifact'] })
  @IsIn(['citation', 'artifact']) kind!: 'citation' | 'artifact';
  @ApiProperty() @IsString() @MaxLength(200) nativeIdentity!: string;
  @ApiProperty() @IsInt() @Min(0) @Max(99) outputOrdinal!: number;
  @ApiProperty() @IsObject() payload!: Record<string, unknown>;
}
