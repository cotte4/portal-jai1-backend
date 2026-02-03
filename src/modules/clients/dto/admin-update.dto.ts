import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsIn,
  IsDateString,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  registerDecorator,
  ValidationOptions,
  Min,
  MinLength,
  ValidateIf,
  MaxLength,
} from 'class-validator';
import {
  ProblemType,
  CaseStatus,
  FederalStatusNew,
  StateStatusNew,
} from '@prisma/client';

/**
 * Custom validator to ensure a date string represents a valid calendar date.
 * JavaScript's Date constructor auto-corrects invalid dates (Feb 30 → Mar 1),
 * so we need to explicitly check that the parsed date matches the input.
 */
@ValidatorConstraint({ name: 'isValidCalendarDate', async: false })
export class IsValidCalendarDateConstraint implements ValidatorConstraintInterface {
  validate(value: string, _args: ValidationArguments): boolean {
    if (!value) return true; // Let @IsOptional handle null/undefined

    // Parse the date string (expected format: YYYY-MM-DD)
    const parts = value.split('-');
    if (parts.length !== 3) return false;

    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);

    // Create date and check if it matches the input
    // If input was Feb 30, JS creates Mar 1, so comparison will fail
    const date = new Date(year, month - 1, day);

    return (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    );
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} is not a valid calendar date`;
  }
}

export function IsValidCalendarDate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsValidCalendarDateConstraint,
    });
  };
}

/**
 * Custom validator to ensure a date string is not in the future.
 * Used for deposit dates - you can't have deposited money in the future.
 */
@ValidatorConstraint({ name: 'isNotFutureDate', async: false })
export class IsNotFutureDateConstraint implements ValidatorConstraintInterface {
  validate(value: string, _args: ValidationArguments): boolean {
    if (!value) return true; // Let @IsOptional handle null/undefined
    const inputDate = new Date(value);
    const today = new Date();
    // Set time to end of day for today to allow same-day deposits
    today.setHours(23, 59, 59, 999);
    return inputDate <= today;
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} cannot be in the future`;
  }
}

export function IsNotFutureDate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsNotFutureDateConstraint,
    });
  };
}

export class UpdateStatusDto {
  @ApiPropertyOptional({ description: 'General comment for status update' })
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Comment must be less than 2000 characters' })
  comment?: string;

  @ApiPropertyOptional({ description: 'Comment specific to federal status' })
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Federal comment must be less than 1000 characters' })
  federalComment?: string;

  @ApiPropertyOptional({ description: 'Comment specific to state status' })
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'State comment must be less than 1000 characters' })
  stateComment?: string;

  @ApiPropertyOptional({ description: 'Estimated federal refund date', example: '2024-03-15' })
  @IsOptional()
  @IsDateString()
  @IsValidCalendarDate({ message: 'Fecha estimada federal no es valida' })
  federalEstimatedDate?: string;

  @ApiPropertyOptional({ description: 'Actual federal refund amount', example: 2500 })
  @IsOptional()
  @ValidateIf((o) => o.federalActualRefund !== null && o.federalActualRefund !== undefined)
  @IsNumber()
  @Min(0, { message: 'Federal refund cannot be negative' })
  federalActualRefund?: number;

  @ApiPropertyOptional({ description: 'Federal refund deposit date', example: '2024-03-10' })
  @IsOptional()
  @IsDateString()
  @IsValidCalendarDate({ message: 'Fecha de deposito federal no es valida (ej: 30 de febrero)' })
  federalDepositDate?: string;

  @ApiPropertyOptional({ description: 'Estimated state refund date', example: '2024-04-01' })
  @IsOptional()
  @IsDateString()
  @IsValidCalendarDate({ message: 'Fecha estimada estatal no es valida' })
  stateEstimatedDate?: string;

  @ApiPropertyOptional({ description: 'Actual state refund amount', example: 800 })
  @IsOptional()
  @ValidateIf((o) => o.stateActualRefund !== null && o.stateActualRefund !== undefined)
  @IsNumber()
  @Min(0, { message: 'State refund cannot be negative' })
  stateActualRefund?: number;

  @ApiPropertyOptional({ description: 'State refund deposit date', example: '2024-03-25' })
  @IsOptional()
  @IsDateString()
  @IsValidCalendarDate({ message: 'Fecha de deposito estatal no es valida (ej: 30 de febrero)' })
  stateDepositDate?: string;

  @ApiPropertyOptional({ description: 'Case status (pre-filing workflow)' })
  @IsOptional()
  @IsEnum(CaseStatus, { message: 'Invalid case status' })
  caseStatus?: CaseStatus;

  @ApiPropertyOptional({ description: 'Federal status (post-filing tracking)' })
  @IsOptional()
  @IsEnum(FederalStatusNew, { message: 'Invalid federal status' })
  federalStatusNew?: FederalStatusNew;

  @ApiPropertyOptional({ description: 'State status (post-filing tracking)' })
  @IsOptional()
  @IsEnum(StateStatusNew, { message: 'Invalid state status' })
  stateStatusNew?: StateStatusNew;

  @ApiPropertyOptional({ description: 'Federal commission rate (0.11 or 0.22)' })
  @IsOptional()
  @IsNumber()
  @IsIn([0.11, 0.22], { message: 'Commission rate must be 0.11 or 0.22' })
  federalCommissionRate?: number;

  @ApiPropertyOptional({ description: 'State commission rate (0.11 or 0.22)' })
  @IsOptional()
  @IsNumber()
  @IsIn([0.11, 0.22], { message: 'Commission rate must be 0.11 or 0.22' })
  stateCommissionRate?: number;

  @ApiPropertyOptional({ description: 'Force an otherwise invalid status transition', default: false })
  @IsOptional()
  @IsBoolean()
  forceTransition?: boolean;

  @ApiPropertyOptional({ description: 'Reason for forcing transition (required if forceTransition=true, min 10 chars)' })
  @ValidateIf((o) => o.forceTransition === true)
  @IsString()
  @MinLength(10, { message: 'Override reason must be at least 10 characters' })
  @MaxLength(500, { message: 'Override reason must be less than 500 characters' })
  overrideReason?: string;
}

// DEPRECATED: UpdateAdminStepDto removed - use internalStatus changes instead

export class SetProblemDto {
  @ApiProperty({ description: 'Whether client has a problem' })
  @IsBoolean()
  hasProblem: boolean;

  @ApiPropertyOptional({ description: 'Type of problem (required if hasProblem=true)' })
  @ValidateIf((o) => o.hasProblem === true)
  @IsEnum(ProblemType, { message: 'Problem type is required when marking a problem' })
  problemType?: ProblemType;

  @ApiPropertyOptional({ description: 'Detailed description of the problem' })
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Problem description must be less than 2000 characters' })
  problemDescription?: string;
}

export class SendNotificationDto {
  @ApiProperty({ description: 'Notification title', example: 'Important Update' })
  @IsString()
  @MaxLength(200, { message: 'Title must be less than 200 characters' })
  title: string;

  @ApiProperty({ description: 'Notification message content' })
  @IsString()
  @MaxLength(2000, { message: 'Message must be less than 2000 characters' })
  message: string;

  @ApiPropertyOptional({ description: 'Whether to also send email notification', default: false })
  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;
}

/**
 * DTO for admin updates to client profile data (including credentials)
 */
export class AdminUpdateProfileDto {
  @ApiPropertyOptional({ description: 'Social Security Number' })
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'SSN must be less than 20 characters' })
  ssn?: string;

  @ApiPropertyOptional({ description: 'Street address' })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Street address must be less than 500 characters' })
  addressStreet?: string;

  @ApiPropertyOptional({ description: 'City' })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'City must be less than 100 characters' })
  addressCity?: string;

  @ApiPropertyOptional({ description: 'State' })
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'State must be less than 50 characters' })
  addressState?: string;

  @ApiPropertyOptional({ description: 'ZIP code' })
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'ZIP code must be less than 20 characters' })
  addressZip?: string;

  @ApiPropertyOptional({ description: 'TurboTax account email' })
  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'TurboTax email must be less than 255 characters' })
  turbotaxEmail?: string;

  @ApiPropertyOptional({ description: 'TurboTax account password' })
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'TurboTax password must be less than 200 characters' })
  turbotaxPassword?: string;

  @ApiPropertyOptional({ description: 'IRS account username' })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'IRS username must be less than 100 characters' })
  irsUsername?: string;

  @ApiPropertyOptional({ description: 'IRS account password' })
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'IRS password must be less than 200 characters' })
  irsPassword?: string;

  @ApiPropertyOptional({ description: 'State tax portal username' })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'State username must be less than 100 characters' })
  stateUsername?: string;

  @ApiPropertyOptional({ description: 'State tax portal password' })
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'State password must be less than 200 characters' })
  statePassword?: string;

  @ApiPropertyOptional({ description: 'Bank name' })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Bank name must be less than 100 characters' })
  bankName?: string;

  @ApiPropertyOptional({ description: 'Bank routing number' })
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Routing number must be less than 20 characters' })
  bankRoutingNumber?: string;

  @ApiPropertyOptional({ description: 'Bank account number' })
  @IsOptional()
  @IsString()
  @MaxLength(30, { message: 'Account number must be less than 30 characters' })
  bankAccountNumber?: string;

  @ApiPropertyOptional({ description: 'State where client worked' })
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'Work state must be less than 50 characters' })
  workState?: string;

  @ApiPropertyOptional({ description: 'Employer name' })
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'Employer name must be less than 200 characters' })
  employerName?: string;
}

/**
 * DTO for marking commission as paid (admin action)
 */
export class MarkCommissionPaidDto {
  @ApiProperty({ enum: ['federal', 'state'], description: 'Type of commission to mark as paid' })
  @IsEnum(['federal', 'state'], { message: 'Type must be either federal or state' })
  type: 'federal' | 'state';
}
