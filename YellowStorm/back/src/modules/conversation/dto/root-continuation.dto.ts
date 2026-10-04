import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, IsMongoId, IsNotEmpty, IsObject, IsOptional, IsString, Max, Min, MaxLength, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class NativeInputResponseDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(256) inputId!: string;
  @IsOptional() @IsInt() @Min(1) @Max(1000000) inputVersion?: number;
  @ApiProperty({ type: Object }) @IsObject() response!: Record<string, unknown>;
}

export class RootContinuationDto {
  @ApiProperty() @IsMongoId() executionId!: string;
  @ApiProperty({ type: [NativeInputResponseDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(64)
  @ArrayUnique((input: NativeInputResponseDto) => input.inputId)
  @ValidateNested({ each: true }) @Type(() => NativeInputResponseDto)
  inputResponses!: NativeInputResponseDto[];
}
