import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { HealthHistory, HealthHistoryDocument, HealthCheckDetailRecord } from './schemas/health-history.schema';
import { HealthService } from './health.service';
import { LoggerService } from '../logger';

// Plain object type for lean queries
export interface HealthHistoryRecord {
  _id: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  version: string;
  uptime: number;
  checks: Record<string, HealthCheckDetailRecord>;
  recordedAt: Date;
  expireAt: Date;
}

export interface HealthHistoryQuery {
  /** Time range in minutes (default: 60) */
  minutes?: number;
  /** Filter by status */
  status?: 'healthy' | 'unhealthy' | 'degraded';
  /** Limit number of results (default: 100, max: 1000) */
  limit?: number;
  /** Skip for pagination */
  skip?: number;
}

export interface HealthHistoryResponse {
  records: HealthHistoryRecord[];
  total: number;
  query: {
    from: Date;
    to: Date;
    minutes: number;
  };
}

export interface HealthHistoryStats {
  totalRecords: number;
  uptimePercentage: number;
  avgResponseTimes: Record<string, number>;
  statusBreakdown: {
    healthy: number;
    unhealthy: number;
    degraded: number;
  };
  period: {
    from: Date;
    to: Date;
    minutes: number;
  };
}

@Injectable()
export class HealthHistoryService implements OnModuleInit, OnModuleDestroy {
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;
  private readonly retentionHours: number;
  private isRunning = false;

  constructor(
    @InjectModel(HealthHistory.name)
    private readonly healthHistoryModel: Model<HealthHistoryDocument>,
    private readonly healthService: HealthService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(HealthHistoryService.name);

    // Default: check every 30 seconds
    this.intervalMs = this.configService.get<number>('health.checkIntervalSeconds', 60) * 1000;
    // Default: retain for 24 hours
    this.retentionHours = this.configService.get<number>('health.retentionHours', 24);
  }

  async onModuleInit(): Promise<void> {
    const enabled = this.configService.get<boolean>('health.historyEnabled', true);

    if (!enabled) {
      this.logger.log('Health history tracking is disabled');
      return;
    }

    this.startPeriodicChecks();
    this.logger.log('Health history tracking started', {
      intervalSeconds: this.intervalMs / 1000,
      retentionHours: this.retentionHours,
    });
  }

  onModuleDestroy(): void {
    this.stopPeriodicChecks();
  }

  /**
   * Start periodic health checks
   */
  startPeriodicChecks(): void {
    if (this.checkInterval) {
      return;
    }

    // Run immediately on start
    void this.runAndSaveCheck();

    // Then run periodically
    this.checkInterval = setInterval(() => {
      void this.runAndSaveCheck();
    }, this.intervalMs);
  }

  /**
   * Stop periodic health checks
   */
  stopPeriodicChecks(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      this.logger.log('Health history tracking stopped');
    }
  }

  /**
   * Run a health check and save to history
   */
  private async runAndSaveCheck(): Promise<void> {
    // Prevent overlapping checks
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    try {
      const result = await this.healthService.check();

      const expireAt = new Date();
      expireAt.setHours(expireAt.getHours() + this.retentionHours);

      await this.healthHistoryModel.create({
        ...result,
        recordedAt: new Date(),
        expireAt,
      });
    } catch (error) {
      const err = error as Error;
      this.logger.error('Failed to save health check to history', {
        message: err.message,
      });
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get health history for a time range
   */
  async getHistory(query: HealthHistoryQuery = {}): Promise<HealthHistoryResponse> {
    const minutes = Math.min(query.minutes || 60, this.retentionHours * 240);
    const limit = Math.min(query.limit || 100, 1000);
    const skip = query.skip || 0;

    const to = new Date();
    const from = new Date(to.getTime() - minutes * 60 * 1000);

    const filter: Record<string, unknown> = {
      recordedAt: { $gte: from, $lte: to },
    };

    if (query.status) {
      filter.status = query.status;
    }

    const [records, total] = await Promise.all([
      this.healthHistoryModel
        .find(filter)
        .sort({ recordedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.healthHistoryModel.countDocuments(filter).exec(),
    ]);

    return {
      records: records as unknown as HealthHistoryRecord[],
      total,
      query: { from, to, minutes },
    };
  }

  /**
   * Get aggregated stats for a time range
   */
  async getStats(minutes = 60): Promise<HealthHistoryStats> {
    const constrainedMinutes = Math.min(minutes, this.retentionHours * 60);
    const to = new Date();
    const from = new Date(to.getTime() - constrainedMinutes * 60 * 1000);

    const records = await this.healthHistoryModel
      .find({ recordedAt: { $gte: from, $lte: to } })
      .lean()
      .exec();

    const totalRecords = records.length;

    // Calculate status breakdown
    const statusBreakdown = {
      healthy: 0,
      unhealthy: 0,
      degraded: 0,
    };

    // Calculate average response times per check
    const responseTimes: Record<string, number[]> = {};

    for (const record of records) {
      statusBreakdown[record.status]++;

      for (const [checkName, checkDetail] of Object.entries(record.checks)) {
        if (checkDetail.responseTime !== undefined) {
          if (!responseTimes[checkName]) {
            responseTimes[checkName] = [];
          }
          responseTimes[checkName].push(checkDetail.responseTime);
        }
      }
    }

    // Calculate averages
    const avgResponseTimes: Record<string, number> = {};
    for (const [checkName, times] of Object.entries(responseTimes)) {
      avgResponseTimes[checkName] = Math.round(
        times.reduce((a, b) => a + b, 0) / times.length,
      );
    }

    // Calculate uptime percentage (healthy / total * 100)
    const uptimePercentage =
      totalRecords > 0
        ? Math.round((statusBreakdown.healthy / totalRecords) * 10000) / 100
        : 100;

    return {
      totalRecords,
      uptimePercentage,
      avgResponseTimes,
      statusBreakdown,
      period: {
        from,
        to,
        minutes: constrainedMinutes,
      },
    };
  }

  /**
   * Manually trigger a health check and save
   */
  async triggerCheck(): Promise<HealthHistoryDocument> {
    const result = await this.healthService.check();

    const expireAt = new Date();
    expireAt.setHours(expireAt.getHours() + this.retentionHours);

    const record = await this.healthHistoryModel.create({
      ...result,
      recordedAt: new Date(),
      expireAt,
    });

    return record;
  }
}
