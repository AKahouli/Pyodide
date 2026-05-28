import { Injectable } from '@nestjs/common';
import { ConnectedAppTokenService } from '../connected-app/services/connected-app-token.service';
import { LoggerService } from '@modules/logger';

export interface RepositoryQuery {
  search?: string;
  page?: number;
  limit?: number;
}

interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  html_url: string;
  language: string | null;
  updated_at: string;
}

export interface RepositoriesResponse {
  repositories: Array<{
    id: string;
    name: string;
    description: string;
    url: string;
    private: boolean;
    language: string;
    updatedAt: string;
  }>;
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class ConnectorUserService {
  constructor(
    private readonly connectedAppTokenService: ConnectedAppTokenService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ConnectorUserService.name);
  }

  async getRepositories(
    userId: string,
    appKey: string,
    query: RepositoryQuery = {},
  ): Promise<RepositoriesResponse> {
    try {
      const token = await this.connectedAppTokenService.getValidToken(userId, appKey);

      if (appKey === 'github') {
        return this.getGitHubRepositories(token, query);
      }

      // Add support for other apps here in the future
      throw new Error(`Unsupported app key: ${appKey}`);
    } catch (error) {
      this.logger.error('Failed to get repositories', {
        userId,
        appKey,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  private async getGitHubRepositories(
    token: string,
    query: RepositoryQuery,
  ): Promise<RepositoriesResponse> {
    const { search = '', page = 1, limit = 30 } = query;

    // Build GitHub API query
    const perPage = Math.min(limit, 100); // GitHub max is 100
    const sort = 'updated';

    let url = `https://api.github.com/user/repos?per_page=${perPage}&page=${page}&sort=${sort}`;

    if (search) {
      // Use search API for filtering
      url = `https://api.github.com/search/repositories?q=${encodeURIComponent(search + ' user:repos')}&type=user&page=${page}&per_page=${perPage}`;
    }

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'YellowStorm-Connector',
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error('GitHub API error', {
        status: response.status,
        body: errorBody,
      });
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const data = await response.json();

    // Handle search API response format
    if (data.items) {
      return {
        repositories: data.items.map((repo: GitHubRepository) => ({
          id: repo.id.toString(),
          name: repo.name,
          description: repo.description || '',
          url: repo.html_url,
          private: repo.private,
          language: repo.language || '',
          updatedAt: repo.updated_at,
        })),
        total: data.total_count,
        page,
        limit: perPage,
      };
    }

    // Handle direct list response format
    return {
      repositories: data.map((repo: GitHubRepository) => ({
        id: repo.id.toString(),
        name: repo.name,
        description: repo.description || '',
        url: repo.html_url,
        private: repo.private,
        language: repo.language || '',
        updatedAt: repo.updated_at,
      })),
      total: data.length,
      page,
      limit: perPage,
    };
  }
}
