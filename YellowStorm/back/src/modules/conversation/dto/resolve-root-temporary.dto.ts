import { OmitType } from '@nestjs/swagger';
import { ResolveRootDelegateDto } from './resolve-root-delegate.dto';

/** Temporary profiles are derived by the server; callers supply no definition. */
export class ResolveRootTemporaryDto extends OmitType(ResolveRootDelegateDto, ['agentId'] as const) {}
