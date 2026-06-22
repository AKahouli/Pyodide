import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InternalBudgetReserveDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  eventId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  taskId!: string;

  @ApiProperty({ minimum: 0 })
  @IsNumber()
  @Min(0)
  amountUsd!: number;

  @ApiProperty({ minimum: 0 })
  @IsNumber()
  @Min(0)
  tokens!: number;
}
