import { IsArray, IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class ExportCatalogDto {
  @IsIn(['all', 'selected'])
  selection!: 'all' | 'selected';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ids?: string[];

  @IsOptional()
  @IsBoolean()
  includeSecurity?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(12)
  passphrase?: string;
}

export class ImportCatalogDto {
  @IsOptional()
  @IsIn(['skip', 'overwrite'])
  conflictPolicy?: 'skip' | 'overwrite';

  @IsOptional()
  @IsString()
  passphrase?: string;
}
