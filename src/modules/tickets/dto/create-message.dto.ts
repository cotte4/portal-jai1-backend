import { IsString, MinLength, MaxLength } from 'class-validator';

export class CreateMessageDto {
  @IsString()
  @MinLength(1, { message: 'El mensaje no puede estar vacío' })
  @MaxLength(5000, { message: 'El mensaje no puede exceder 5000 caracteres' })
  message: string;
}
