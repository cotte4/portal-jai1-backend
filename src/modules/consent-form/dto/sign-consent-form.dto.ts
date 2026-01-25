import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, Matches } from 'class-validator';

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
}
