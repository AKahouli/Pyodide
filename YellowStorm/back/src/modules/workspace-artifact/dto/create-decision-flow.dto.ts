import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsMongoId, IsOptional, IsString, Length, ValidateIf, ValidateNested } from 'class-validator';

class DecisionFlowAmbiguityPolicyDto {
  @ApiProperty() @IsBoolean() doNotInvent!: boolean;
  @ApiProperty() @IsBoolean() createToConfirmNodes!: boolean;
  @ApiProperty() @IsBoolean() citeSourcePassages!: boolean;
  @ApiProperty() @IsBoolean() identifyContradictions!: boolean;
}

class DecisionFlowGenerationOptionsDto {
  @ApiProperty({ enum: ['eligibility', 'orientation', 'guided_diagnostic', 'procedure', 'other'] }) @IsIn(['eligibility', 'orientation', 'guided_diagnostic', 'procedure', 'other']) flowType!: 'eligibility' | 'orientation' | 'guided_diagnostic' | 'procedure' | 'other';
  @ApiPropertyOptional({ maxLength: 120 }) @ValidateIf((dto: DecisionFlowGenerationOptionsDto) => dto.flowType === 'other') @IsString() @Length(1, 120) customFlowType?: string;
  @ApiProperty({ isArray: true, enum: ['business_creator', 'artisan', 'merchant', 'existing_business', 'infer_from_document'] }) @IsArray() @ArrayNotEmpty() @IsIn(['business_creator', 'artisan', 'merchant', 'existing_business', 'infer_from_document'], { each: true }) targetAudiences!: ('business_creator' | 'artisan' | 'merchant' | 'existing_business' | 'infer_from_document')[];
  @ApiProperty({ enum: ['synthetic', 'standard', 'detailed'] }) @IsIn(['synthetic', 'standard', 'detailed']) detailLevel!: 'synthetic' | 'standard' | 'detailed';
  @ApiProperty({ type: DecisionFlowAmbiguityPolicyDto }) @ValidateNested() @Type(() => DecisionFlowAmbiguityPolicyDto) ambiguityPolicy!: DecisionFlowAmbiguityPolicyDto;
}

export class CreateDecisionFlowDto {
  @ApiProperty() @IsMongoId() sourceDocumentId!: string;
  @ApiPropertyOptional({ maxLength: 150 }) @IsOptional() @IsString() @Length(1, 150) name?: string;
  @ApiProperty({ enum: ['all', 'pages'] }) @IsIn(['all', 'pages']) selectionMode!: 'all' | 'pages';
  @ApiPropertyOptional({ type: [Number] }) @ValidateIf((dto: CreateDecisionFlowDto) => dto.selectionMode === 'pages') @IsArray() pages?: number[];
  @ApiPropertyOptional({ type: DecisionFlowGenerationOptionsDto }) @IsOptional() @ValidateNested() @Type(() => DecisionFlowGenerationOptionsDto) generationOptions?: DecisionFlowGenerationOptionsDto;
}
