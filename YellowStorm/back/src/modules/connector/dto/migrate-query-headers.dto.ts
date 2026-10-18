import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

class QueryHeaderMappingDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  queryKey!: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  headerName!: string;

  /** Explicit, including an empty string. No inferred authentication scheme. */
  @IsString() @MaxLength(200)
  prefix!: string;
}

export class MigrateQueryHeadersDto {
  @IsInt() @Min(1)
  expectedSecurityRevision!: number;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(32) @ValidateNested({ each: true }) @Type(() => QueryHeaderMappingDto)
  mappings!: QueryHeaderMappingDto[];

  @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(200, { each: true })
  removeQueryKeys!: string[];
}
