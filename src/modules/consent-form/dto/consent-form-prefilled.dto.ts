import { ApiProperty } from '@nestjs/swagger';

export class ConsentFormPrefilledDto {
  @ApiProperty({ description: 'Full name of the client' })
  fullName: string;

  @ApiProperty({ description: 'DNI or Passport number (masked)', nullable: true })
  dniPassport: string | null;

  @ApiProperty({ description: 'Street address', nullable: true })
  street: string | null;

  @ApiProperty({ description: 'City', nullable: true })
  city: string | null;

  @ApiProperty({ description: 'Email address' })
  email: string;

  @ApiProperty({ description: 'Current date in Spanish format' })
  date: {
    day: number;
    month: string;
    year: number;
  };

  @ApiProperty({ description: 'Whether the profile is complete enough for signing' })
  canSign: boolean;

  @ApiProperty({ description: 'Missing fields that need to be completed', type: [String] })
  missingFields: string[];
}
