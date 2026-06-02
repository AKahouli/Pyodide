import { PartialType } from '@nestjs/swagger';
import { CreateToolCategoryDto } from './create-tool-category.dto';

export class UpdateToolCategoryDto extends PartialType(CreateToolCategoryDto) {}
