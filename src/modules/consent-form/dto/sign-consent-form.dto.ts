import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, Matches, IsEmail } from 'class-validator';

export class SignConsentFormDto {
  @ApiProperty({
    description: 'Client signature as base64 encoded PNG image',
    example: 'data:image/png;base64,iVBORw0KGgo...',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^data:image\/png;base64,/, {
    message: 'Signature must be a base64 encoded PNG image',
  })
  signature: string;

  @ApiProperty({
    description: 'Client full name',
    example: 'Juan Carlos Perez',
  })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiProperty({
    description: 'Client DNI or Passport number',
    example: '12345678',
  })
  @IsString()
  @IsNotEmpty()
  dniPassport: string;

  @ApiProperty({
    description: 'Client street address',
    example: 'Av. Corrientes 1234',
  })
  @IsString()
  @IsNotEmpty()
  street: string;

  @ApiProperty({
    description: 'Client city',
    example: 'Buenos Aires',
  })
  @IsString()
  @IsNotEmpty()
  city: string;

  @ApiProperty({
    description: 'Client email',
    example: 'juan@email.com',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}
