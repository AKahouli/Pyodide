import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RootStopDto {
  @ApiProperty() @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  stopRequestId!: string;
  @ApiProperty() @IsInt() @Min(0) @Max(2147483647) expectedEpoch!: number;
  @IsOptional() @Matches(/^[0-9a-f]{24}$/) foregroundMessageId?: string;
}

export class RootWorkCursorDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(2147483647) epoch!: number;
  @ApiProperty() @Matches(/^[0-9]{1,20}$/) after = '0';
}
