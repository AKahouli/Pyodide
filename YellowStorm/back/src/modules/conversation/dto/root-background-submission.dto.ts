import { IsIn, IsOptional, Matches } from 'class-validator';
import { ResolveRootTemporaryDto } from './resolve-root-temporary.dto';

export class RootBackgroundSubmissionDto extends ResolveRootTemporaryDto {
  @IsIn(['specialist', 'temporary']) workerKind!: 'specialist' | 'temporary';
  @IsOptional() @Matches(/^[0-9a-f]{24}$/) agentId?: string;
}
