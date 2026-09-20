import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, PipelineStage } from 'mongoose';
import { User } from '@modules/user/schemas/user.schema';
import type { AuthUser } from '@common/auth/auth-user';
import type { UserDocument } from '@modules/user/schemas/user.schema';
import { LoggerService } from '@modules/logger';
import { GroupByPeriod } from '../dto';
import { UserAnalyticsResponse, TimeSeriesDataPoint } from '../interfaces';

@Injectable()
export class UserAnalyticsService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('UserAnalyticsService');
  }

  /**
   * Get IDs of users who have consented to data sharing
   */
  async getConsentingUserIds(): Promise<Types.ObjectId[]> {
    const users = await this.userModel
      .find({ 'consents.dataSharing': true }, { _id: 1 })
      .lean();
    return users.map((u) => u._id as Types.ObjectId);
  }

  /**
   * Get user analytics for consenting users
   */
  async getUserAnalytics(
    dateFrom?: Date,
    dateTo?: Date,
    groupBy: GroupByPeriod = GroupByPeriod.DAY,
  ): Promise<UserAnalyticsResponse> {
    const matchStage: Record<string, unknown> = {
      'consents.dataSharing': true,
    };

    if (dateFrom || dateTo) {
      matchStage.createdAt = {};
      if (dateFrom) {
        (matchStage.createdAt as Record<string, unknown>).$gte = dateFrom;
      }
      if (dateTo) {
        (matchStage.createdAt as Record<string, unknown>).$lte = dateTo;
      }
    }

    // Get total consenting users
    const totalConsentingUsers = await this.userModel.countDocuments({
      'consents.dataSharing': true,
    });

    // Get new users over time
    const newUsersOverTime = await this.getNewUsersOverTime(
      matchStage,
      groupBy,
    );

    // Get verification status
    const verificationStatus = await this.getVerificationStatus();

    // Get profile completion rates
    const profileCompletion = await this.getProfileCompletion();

    return {
      totalConsentingUsers,
      newUsersOverTime,
      verificationStatus,
      profileCompletion,
    };
  }

  private async getNewUsersOverTime(
    matchStage: Record<string, unknown>,
    groupBy: GroupByPeriod,
  ): Promise<TimeSeriesDataPoint[]> {
    const dateFormat = this.getDateFormat(groupBy);

    const pipeline: PipelineStage[] = [
      { $match: matchStage },
      {
        $group: {
          _id: {
            $dateToString: { format: dateFormat, date: '$createdAt' },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 as const } },
      {
        $project: {
          _id: 0,
          date: '$_id',
          count: 1,
        },
      },
    ];

    return this.userModel.aggregate<TimeSeriesDataPoint>(pipeline);
  }

  private async getVerificationStatus(): Promise<{
    verified: number;
    unverified: number;
  }> {
    const result = await this.userModel.aggregate([
      { $match: { 'consents.dataSharing': true } },
      {
        $group: {
          _id: '$emailVerified',
          count: { $sum: 1 },
        },
      },
    ]);

    const verified = result.find((r) => r._id === true)?.count || 0;
    const unverified = result.find((r) => r._id === false)?.count || 0;

    return { verified, unverified };
  }

  private async getProfileCompletion(): Promise<{
    complete: number;
    incomplete: number;
  }> {
    const result = await this.userModel.aggregate([
      { $match: { 'consents.dataSharing': true } },
      {
        $group: {
          _id: '$profileComplete',
          count: { $sum: 1 },
        },
      },
    ]);

    const complete = result.find((r) => r._id === true)?.count || 0;
    const incomplete = result.find((r) => r._id === false)?.count || 0;

    return { complete, incomplete };
  }

  private getDateFormat(groupBy: GroupByPeriod): string {
    switch (groupBy) {
      case GroupByPeriod.DAY:
        return '%Y-%m-%d';
      case GroupByPeriod.WEEK:
        return '%Y-W%V';
      case GroupByPeriod.MONTH:
        return '%Y-%m';
      default:
        return '%Y-%m-%d';
    }
  }
}
