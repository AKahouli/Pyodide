import { PartialType } from '@nestjs/swagger';
import { CreateTemplateCategoryDto } from './create-template-category.dto';

export class UpdateTemplateCategoryDto extends PartialType(CreateTemplateCategoryDto) {}
