import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsObject, IsOptional, Matches, Max, Min } from 'class-validator';
import { OmitType } from '@nestjs/swagger';
import { Equals } from 'class-validator';
import { RootFanoutProposalDto } from './root-fanout-proposal.dto';
import { SettleRootDelegateDto } from './settle-root-delegate.dto';
import type { RootBackgroundEventProposal } from '../root-work/root-background-event';
import { RootContinuationDto } from './root-continuation.dto';
import { Type } from 'class-transformer';

export class RootBackgroundInputsDto extends OmitType(RootContinuationDto, ['executionId'] as const) {}

export class RootBackgroundFanoutDto extends OmitType(RootFanoutProposalDto, ['mode'] as const) {
  @Equals('background') mode!: 'background';
}

export class RootBackgroundAuthorityDto {
  @Matches(/^[A-Za-z0-9_-]{1,128}$/) owner!: string;
  @IsInt() @Min(1) @Max(2147483647) fence!: number;
  @Matches(/^[0-9a-f]{64}$/) requestDigest!: string;
  @IsOptional() @Matches(/^[A-Za-z0-9_-]{1,128}$/) nativeOwner?: string;
}

export class RootBackgroundEventsDto extends RootBackgroundAuthorityDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsObject({ each: true })
  @Type(() => Object)
  events!: RootBackgroundEventProposal[];
}

export class RootBackgroundResultPageDto extends RootBackgroundAuthorityDto {
  @IsOptional() @IsInt() @Min(0) @Max(262144) offset = 0;
}

export class RootBackgroundPermitDto extends RootBackgroundAuthorityDto {
  @IsIn(['acquire', 'release']) operation!: 'acquire' | 'release';
  @Matches(/^[A-Za-z0-9_-]{1,128}$/) permitOwner!: string;
}

export class RootBackgroundSettlementDto extends OmitType(SettleRootDelegateDto, ['status'] as const) {
  @Matches(/^[A-Za-z0-9_-]{1,128}$/) owner!: string;
  @IsInt() @Min(1) @Max(2147483647) fence!: number;
  @Matches(/^[0-9a-f]{64}$/) requestDigest!: string;
  @IsOptional() @Matches(/^[A-Za-z0-9_-]{1,128}$/) nativeOwner?: string;
  @IsIn(['waiting', 'completed', 'failed', 'outcome_unknown', 'cancelled'])
  status!: 'waiting' | 'completed' | 'failed' | 'outcome_unknown' | 'cancelled';
}
