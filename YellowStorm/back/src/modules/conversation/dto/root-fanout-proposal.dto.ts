import { ArrayMaxSize, ArrayMinSize, Equals, IsArray, IsIn, IsObject, IsString, MaxLength } from 'class-validator';
import type { FanoutProposalV1 } from '../root-work/root-fanout-manifest';

export class RootFanoutProposalDto implements FanoutProposalV1 {
  @Equals(1) version!: 1;
  @IsIn(['foreground']) mode!: 'foreground';
  @IsString() @MaxLength(256) nativeCallId!: string;
  @IsString() @MaxLength(2048) nativeCallBranch!: string;
  @IsObject() target!: FanoutProposalV1['target'];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) items!: FanoutProposalV1['items'];
}
