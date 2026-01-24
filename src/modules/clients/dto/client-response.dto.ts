import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Basic user info included in client responses.
 */
export class ClientUserDto {
  @ApiProperty({ description: 'User ID' })
  id: string;

  @ApiProperty({ description: 'User email' })
  email: string;

  @ApiPropertyOptional({ description: 'User first name' })
  firstName?: string;

  @ApiPropertyOptional({ description: 'User last name' })
  lastName?: string;
}

/**
 * Status alarm DTO for tax case tracking.
 */
export class StatusAlarmDto {
  @ApiProperty({ description: 'Alarm type', enum: ['federal', 'state'] })
  type: 'federal' | 'state';

  @ApiProperty({ description: 'Current status' })
  status: string;

  @ApiProperty({ description: 'Days since status changed' })
  daysSinceChange: number;

  @ApiProperty({ description: 'Alarm severity', enum: ['low', 'medium', 'high', 'critical'] })
  severity: 'low' | 'medium' | 'high' | 'critical';

  @ApiProperty({ description: 'Human-readable alarm message' })
  message: string;
}

/**
 * Client list item DTO (for admin findAll endpoint).
 */
export class ClientListItemDto {
  @ApiProperty({ description: 'Client profile ID' })
  id: string;

  @ApiProperty({ description: 'Associated user', type: ClientUserDto })
  user: ClientUserDto;

  @ApiProperty({ description: 'Creation date' })
  createdAt: Date;

  @ApiProperty({ description: 'Whether profile is complete' })
  profileComplete: boolean;

  @ApiProperty({ description: 'Whether profile is in draft state' })
  isDraft: boolean;

  @ApiProperty({ description: 'Whether profile is ready to present' })
  isReadyToPresent: boolean;

  @ApiProperty({ description: 'Whether profile is incomplete' })
  isIncomplete: boolean;

  @ApiPropertyOptional({ description: 'Tax case ID' })
  taxCaseId?: string;

  @ApiPropertyOptional({ description: 'Whether taxes have been filed' })
  taxesFiled?: boolean;

  @ApiPropertyOptional({ description: 'Date when taxes were filed' })
  taxesFiledAt?: Date;

  @ApiPropertyOptional({ description: 'Federal status' })
  federalStatusNew?: string;

  @ApiPropertyOptional({ description: 'State status' })
  stateStatusNew?: string;

  @ApiPropertyOptional({ description: 'Whether payment has been received' })
  paymentReceived?: boolean;

  @ApiPropertyOptional({ description: 'Federal actual refund amount' })
  federalActualRefund?: number;

  @ApiPropertyOptional({ description: 'State actual refund amount' })
  stateActualRefund?: number;

  @ApiPropertyOptional({ description: 'Whether case has a problem' })
  hasProblem?: boolean;

  @ApiPropertyOptional({ description: 'Problem type if any' })
  problemType?: string;

  @ApiPropertyOptional({ description: 'List of missing items', type: [String] })
  missingItems?: string[];

  @ApiPropertyOptional({ description: 'Active alarms', type: [StatusAlarmDto] })
  alarms?: StatusAlarmDto[];
}

/**
 * Paginated clients response.
 */
export class ClientsPaginatedResponseDto {
  @ApiProperty({ description: 'List of clients', type: [ClientListItemDto] })
  clients: ClientListItemDto[];

  @ApiPropertyOptional({ description: 'Cursor for next page', nullable: true })
  nextCursor: string | null;

  @ApiProperty({ description: 'Whether more results exist' })
  hasMore: boolean;
}

/**
 * Season stats response.
 */
export class SeasonStatsResponseDto {
  @ApiProperty({ description: 'Total number of clients' })
  totalClients: number;

  @ApiProperty({ description: 'Number of clients with completed profiles' })
  profilesCompleted: number;

  @ApiProperty({ description: 'Number of taxes filed' })
  taxesFiled: number;

  @ApiProperty({ description: 'Number of payments received' })
  paymentsReceived: number;

  @ApiProperty({ description: 'Total refunds amount' })
  totalRefunds: number;
}
