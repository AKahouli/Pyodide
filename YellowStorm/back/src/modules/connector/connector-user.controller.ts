import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConnectorUserService, RepositoryQuery } from './connector-user.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../user/schemas/user.schema';

@Controller('connectors')
@UseGuards(JwtAuthGuard)
export class ConnectorUserController {
  constructor(private readonly connectorUserService: ConnectorUserService) {}

  /**
   * Get repositories for a connected app (e.g., GitHub repos)
   * Query params:
   * - appKey: The connected app key (e.g., 'github')
   * - search: Optional search query
   * - page: Page number (default: 1)
   * - limit: Items per page (default: 30)
   */
  @Get('repositories')
  async getRepositories(
    @CurrentUser() user: UserDocument,
    @Query('appKey') appKey: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.connectorUserService.getRepositories(user.id.toString(), appKey, {
      search,
      page: page ? Number.parseInt(page, 10) : 1,
      limit: limit ? Number.parseInt(limit, 10) : 30,
    });
  }
}
