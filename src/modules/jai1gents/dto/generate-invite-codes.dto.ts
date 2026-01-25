import { IsInt, Min, Max } from 'class-validator';

export class GenerateInviteCodesDto {
  @IsInt({ message: 'Count must be an integer' })
  @Min(1, { message: 'Must generate at least 1 code' })
  @Max(100, { message: 'Cannot generate more than 100 codes at once' })
  count: number;
}
