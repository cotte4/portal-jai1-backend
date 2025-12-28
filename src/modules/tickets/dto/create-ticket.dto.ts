import { IsString, MinLength, MaxLength } from 'class-validator';

export class CreateTicketDto {
  @IsString()
  @MinLength(5)
  @MaxLength(200)
  subject: string;
}
