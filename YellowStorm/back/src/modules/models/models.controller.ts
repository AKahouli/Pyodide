import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { ModelsService } from './models.service';
import { ModelResponse, ModelsListResponse } from './interfaces/model.interface';
import { NotFoundException, ErrorCode } from '../exceptions';

@ApiTags('Models')
@Controller('model-catalog')
@ApiBearerAuth()
export class ModelsController {
  constructor(private readonly modelsService: ModelsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all available models' })
  @ApiResponse({
    status: 200,
    description: 'List of available AI models',
  })
  async findAll(): Promise<ModelsListResponse> {
    return this.modelsService.findAll();
  }

  @Get('chef/:chefSlug')
  @ApiOperation({ summary: 'Get models by provider (chef)' })
  @ApiParam({
    name: 'chefSlug',
    description: 'Provider slug (e.g., openai, anthropic)',
    example: 'openai',
  })
  @ApiResponse({
    status: 200,
    description: 'List of models from the specified provider',
  })
  async findByChef(@Param('chefSlug') chefSlug: string): Promise<ModelsListResponse> {
    return this.modelsService.findByChef(chefSlug);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get model by ID' })
  @ApiParam({
    name: 'id',
    description: 'Model ID (e.g., gpt-4o, claude-3-opus)',
    example: 'gpt-4o',
  })
  @ApiResponse({
    status: 200,
    description: 'Model details',
  })
  @ApiResponse({
    status: 404,
    description: 'Model not found',
  })
  async findOne(@Param('id') id: string): Promise<ModelResponse> {
    const model = await this.modelsService.findById(id);

    if (!model) {
      throw new NotFoundException(ErrorCode.MODEL_NOT_FOUND);
    }

    return model;
  }
}
