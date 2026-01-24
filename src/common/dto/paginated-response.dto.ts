import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Generic paginated response wrapper for cursor-based pagination.
 * Used across all paginated endpoints for consistent response format.
 */
export class PaginatedResponseDto<T> {
  @ApiProperty({ description: 'Array of items' })
  data: T[];

  @ApiPropertyOptional({ description: 'Cursor for next page', nullable: true })
  nextCursor: string | null;

  @ApiProperty({ description: 'Whether more results exist' })
  hasMore: boolean;
}

/**
 * Generic paginated response wrapper for offset-based pagination.
 */
export class OffsetPaginatedResponseDto<T> {
  @ApiProperty({ description: 'Array of items' })
  data: T[];

  @ApiProperty({ description: 'Total count of items' })
  total: number;

  @ApiProperty({ description: 'Current page number' })
  page: number;

  @ApiProperty({ description: 'Items per page' })
  limit: number;

  @ApiProperty({ description: 'Whether more results exist' })
  hasMore: boolean;
}

/**
 * Base success response wrapper.
 */
export class SuccessResponseDto {
  @ApiProperty({ description: 'Operation success status', example: true })
  success: boolean;

  @ApiPropertyOptional({ description: 'Optional message' })
  message?: string;
}

/**
 * Error response wrapper.
 */
export class ErrorResponseDto {
  @ApiProperty({ description: 'HTTP status code', example: 400 })
  statusCode: number;

  @ApiProperty({ description: 'Error message', example: 'Validation failed' })
  message: string;

  @ApiPropertyOptional({ description: 'Error code for client handling' })
  error?: string;
}
