import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AnalyticsService } from '../services/analytics.service';
import { AnalyticsQueryDto } from '../dto';
import { RequirePermissions, PermissionsGuard, Permissions } from '../../authorization';

@ApiTags('Analytics (Experimental)')
@ApiBearerAuth()
@Controller('experimental/analytics')
@UseGuards(PermissionsGuard)
@RequirePermissions(Permissions.ANALYTICS_READ)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('users')
  @ApiOperation({
    summary: 'Get user analytics',
    description:
      'Returns analytics about consenting users including registration trends, verification status, and profile completion rates.',
  })
  @ApiResponse({ status: 200, description: 'User analytics data' })
  async getUserAnalytics(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getUserAnalytics(
      query.dateFrom,
      query.dateTo,
      query.groupBy,
    );
  }

  @Get('usage')
  @ApiOperation({
    summary: 'Get usage analytics',
    description:
      'Returns token usage analytics including totals, breakdown by model, and usage trends over time.',
  })
  @ApiResponse({ status: 200, description: 'Usage analytics data' })
  async getUsageAnalytics(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getUsageAnalytics(
      query.dateFrom,
      query.dateTo,
      query.groupBy,
    );
  }

  @Get('conversations')
  @ApiOperation({
    summary: 'Get conversation analytics',
    description:
      'Returns conversation analytics including message counts, component distribution, and conversation duration.',
  })
  @ApiResponse({ status: 200, description: 'Conversation analytics data' })
  async getConversationAnalytics(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getConversationAnalytics(
      query.dateFrom,
      query.dateTo,
      query.groupBy,
    );
  }

  @Get('quality')
  @ApiOperation({
    summary: 'Get quality analytics',
    description:
      'Returns quality analytics including feedback distribution, report counts by category, and regeneration rates.',
  })
  @ApiResponse({ status: 200, description: 'Quality analytics data' })
  async getQualityAnalytics(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getQualityAnalytics(
      query.dateFrom,
      query.dateTo,
    );
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Get summary dashboard analytics',
    description:
      'Returns an aggregated overview of all key metrics for a dashboard view.',
  })
  @ApiResponse({ status: 200, description: 'Summary analytics data' })
  async getSummaryAnalytics(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getSummaryAnalytics(
      query.dateFrom,
      query.dateTo,
    );
  }
}
