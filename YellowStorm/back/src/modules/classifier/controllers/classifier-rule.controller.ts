import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ClassifierRuleService } from '../services/classifier-rule.service';
import { CreateRuleDto } from '../dto/create-rule.dto';
import { UpdateRuleDto } from '../dto/update-rule.dto';
import { ListRulesQueryDto } from '../dto/list-rules-query.dto';
import { IClassifierRuleResponse } from '../interfaces/classifier.interface';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserDocument } from '../../user/schemas/user.schema';

@ApiTags('Classifier · Rules')
@ApiBearerAuth()
@Controller('classifier/rules')
export class ClassifierRuleController {
  constructor(private readonly ruleService: ClassifierRuleService) {}

  @Get()
  @ApiOperation({ summary: 'List classifier rules (optionally filter by scope/workspace)' })
  list(
    @CurrentUser() user: UserDocument,
    @Query() query: ListRulesQueryDto,
  ): Promise<IClassifierRuleResponse[]> {
    return this.ruleService.list(user._id.toString(), query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a classifier rule (global or local to a workspace)' })
  create(
    @CurrentUser() user: UserDocument,
    @Body() dto: CreateRuleDto,
  ): Promise<IClassifierRuleResponse> {
    return this.ruleService.create(user._id.toString(), dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a rule text or enabled state' })
  @ApiParam({ name: 'id', description: 'Rule ID' })
  update(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: UpdateRuleDto,
  ): Promise<IClassifierRuleResponse> {
    return this.ruleService.update(user._id.toString(), id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a classifier rule' })
  @ApiParam({ name: 'id', description: 'Rule ID' })
  delete(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
  ): Promise<void> {
    return this.ruleService.delete(user._id.toString(), id);
  }
}
