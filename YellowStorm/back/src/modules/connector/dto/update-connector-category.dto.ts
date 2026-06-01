import { PartialType } from '@nestjs/swagger';
import { CreateConnectorCategoryDto } from './create-connector-category.dto';

export class UpdateConnectorCategoryDto extends PartialType(CreateConnectorCategoryDto) {}
