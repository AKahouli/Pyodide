import { Body, Controller, Post, UseGuards, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Allow, IsArray, IsBoolean, IsOptional, IsString, MaxLength, ArrayMaxSize, ArrayMinSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Public } from '../../auth/decorators/public.decorator';
import { InternalServiceGuard } from '../../auth/guards/internal-service.guard';
import {
  AttributeExtractionRequest,
  SemanticAttributeExtractionService,
} from '../services/semantic-attribute-extraction.service';

export class AttributeExtractionAttributeDto {
  @IsString()
  @MaxLength(80)
  key!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  type?: string;
}

export class AttributeExtractionSectionDto {
  // Opaque logical-index identifiers, validated by the ADK contract; they are
  // only used to ground a value back to a block the runtime actually sent.
  @Allow()
  sectionPk!: string | number;

  @Allow()
  blockPk!: string | number;

  @IsString()
  @MaxLength(20000)
  content!: string;
}

export class AiExtractionIdentityDto {
  @IsString()
  @MaxLength(200)
  agentSlug!: string;

  @IsString()
  @MaxLength(200)
  model!: string;

  @IsString()
  @MaxLength(100)
  contractVersion!: string;
}

export class AttributeExtractionRequestDto {
  @IsString()
  @MaxLength(128)
  modelId!: string;

  @ValidateNested()
  @Type(() => AiExtractionIdentityDto)
  aiExtraction!: AiExtractionIdentityDto;

  @IsString()
  @MaxLength(128)
  conceptId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  conceptLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  documentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  fileName?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AttributeExtractionAttributeDto)
  attributes!: AttributeExtractionAttributeDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AttributeExtractionSectionDto)
  sections!: AttributeExtractionSectionDto[];

  /** The mapping reads several records from this document. */
  @IsOptional()
  @IsBoolean()
  multiple?: boolean;
}

/**
 * Trusted service-to-service attribute extraction for the semantic-model
 * population runtime. Authenticated with X-Internal-Token; the runtime never
 * talks to the ADK directly.
 */
@ApiTags('Semantic Model Internal')
@Public()
@Controller({ path: 'semantic-model/internal', version: VERSION_NEUTRAL })
@UseGuards(InternalServiceGuard)
export class SemanticAttributeExtractionInternalController {
  constructor(private readonly extraction: SemanticAttributeExtractionService) {}

  @Post('attribute-extraction')
  @ApiOperation({ summary: 'Extract mapped attribute values from one document through the ADK extraction agent' })
  async extract(@Body() dto: AttributeExtractionRequestDto) {
    return this.extraction.extract(dto as AttributeExtractionRequest);
  }
}
