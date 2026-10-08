import { IsIn, Matches } from 'class-validator';

export class RootWorkerPermitDto {
  @IsIn(['acquire', 'release']) operation!: 'acquire' | 'release';
  @Matches(/^[A-Za-z0-9_-]{1,128}$/) owner!: string;
}
