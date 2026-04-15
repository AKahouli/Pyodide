import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SkillService } from './skill.service';
import { ISkillResponse } from './interfaces/skill.interface';

@ApiTags('Skills')
@ApiBearerAuth()
@Controller('skills')
export class SkillController {
  constructor(private readonly skillService: SkillService) {}

  @Get('active')
  @ApiOperation({ summary: 'List all active skills' })
  async findAllActive(): Promise<ISkillResponse[]> {
    return this.skillService.findAllActive();
  }
}
