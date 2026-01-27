import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum RefundType {
  federal = 'federal',
  state = 'state',
}

export class ConfirmRefundDto {
  @ApiProperty({
    enum: RefundType,
    description: 'Type of refund to confirm (federal or state)',
    example: 'federal',
  })
  @IsEnum(RefundType, { message: 'type must be either federal or state' })
  type: RefundType;
}
