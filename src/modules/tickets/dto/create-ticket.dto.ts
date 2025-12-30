import { IsString, MinLength, MaxLength, IsOptional } from 'class-validator';

export class CreateTicketDto {
  @IsString()
  @MinLength(5, { message: 'Subject must be at least 5 characters' })
  @MaxLength(200, { message: 'Subject must not exceed 200 characters' })
  subject: string;

  @IsString()
  @IsOptional()
  @MinLength(1, { message: 'Message cannot be empty' })
  @MaxLength(2000, { message: 'Message must not exceed 2000 characters' })
  message?: string;
}
