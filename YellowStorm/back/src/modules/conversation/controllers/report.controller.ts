import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ReportService } from '../services/report.service';
import { CreateReportDto } from '../dto/create-report.dto';
import { ReportQueryDto } from '../dto/report-query.dto';
import { ConversationOwnerGuard } from '../guards/conversation-owner.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ReportStatus, ReportDetailResponse } from '../interfaces/report.interface';
import { RequirePermissions, PermissionsGuard, Permissions } from '../../authorization';

@ApiTags('Reports')
@Controller()
@ApiBearerAuth()
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Post('conversations/:conversationId/messages/:messageId/report')
  @UseGuards(ConversationOwnerGuard)
  async createReport(
    @CurrentUser() user: { _id: string },
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Body() dto: CreateReportDto,
  ) {
    return this.reportService.createReport({
      conversationId,
      messageId,
      userId: user._id.toString(),
      reason: dto.reason,
      description: dto.description,
    });
  }

  @Get('reports')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permissions.REPORTS_READ)
  async findAll(@Query() query: ReportQueryDto) {
    return this.reportService.findAll(query);
  }

  @Get('reports/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permissions.REPORTS_READ)
  async findOne(@Param('id') id: string): Promise<ReportDetailResponse> {
    return this.reportService.findById(id);
  }

  @Patch('reports/:id/status')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permissions.REPORTS_UPDATE)
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: ReportStatus; adminNotes?: string },
  ) {
    return this.reportService.updateStatus(id, body.status, body.adminNotes);
  }
}
