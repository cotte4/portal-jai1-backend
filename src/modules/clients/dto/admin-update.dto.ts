import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsNumber,
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
  TaxStatus,
  ProblemType,
  PreFilingStatus,
  CaseStatus,
  FederalStatusNew,
  StateStatusNew,
} from '@prisma/client';

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
  // Phase indicator - when true, use federalStatus/stateStatus
  @IsOptional()
  @IsBoolean()
  taxesFiled?: boolean;

  @IsOptional()
  @IsDateString()
  @IsNotFutureDate({ message: 'Taxes filed date cannot be in the future' })
  taxesFiledAt?: string;

  // NEW: Pre-filing status (used when taxesFiled = false)
  @IsOptional()
  @IsEnum(PreFilingStatus, { message: 'Invalid pre-filing status' })
  preFilingStatus?: PreFilingStatus;

  // Federal/State status (used when taxesFiled = true)
  @IsOptional()
  @IsEnum(TaxStatus, { message: 'Invalid federal status' })
  federalStatus?: TaxStatus;

  @IsOptional()
  @IsEnum(TaxStatus, { message: 'Invalid state status' })
  stateStatus?: TaxStatus;

  // Comment is REQUIRED for status updates in new system (validated in service)
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Comment must be less than 2000 characters' })
  comment?: string;

  // NEW: Separate comments for federal/state tracks
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Federal comment must be less than 1000 characters' })
  federalComment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'State comment must be less than 1000 characters' })
  stateComment?: string;

  // Federal tracking fields
  @IsOptional()
  @IsDateString()
  federalEstimatedDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Federal refund cannot be negative' })
  federalActualRefund?: number;

  @IsOptional()
  @IsDateString()
  @IsNotFutureDate({ message: 'Federal deposit date cannot be in the future' })
  federalDepositDate?: string;

  // State tracking fields
  @IsOptional()
  @IsDateString()
  stateEstimatedDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'State refund cannot be negative' })
  stateActualRefund?: number;

  @IsOptional()
  @IsDateString()
  @IsNotFutureDate({ message: 'State deposit date cannot be in the future' })
  stateDepositDate?: string;

  // ============= NEW STATUS SYSTEM (v2) =============

  // Unified case status (replaces preFilingStatus + taxesFiled)
  @IsOptional()
  @IsEnum(CaseStatus, { message: 'Invalid case status' })
  caseStatus?: CaseStatus;

  // Enhanced federal status
  @IsOptional()
  @IsEnum(FederalStatusNew, { message: 'Invalid federal status (new)' })
  federalStatusNew?: FederalStatusNew;

  // Enhanced state status
  @IsOptional()
  @IsEnum(StateStatusNew, { message: 'Invalid state status (new)' })
  stateStatusNew?: StateStatusNew;

  // ============= FORCE TRANSITION OVERRIDE =============

  // Allow admin to force an otherwise invalid status transition
  @IsOptional()
  @IsBoolean()
  forceTransition?: boolean;

  // Reason is required when forcing a transition (min 10 chars)
  @ValidateIf((o) => o.forceTransition === true)
  @IsString()
  @MinLength(10, { message: 'Override reason must be at least 10 characters' })
  @MaxLength(500, { message: 'Override reason must be less than 500 characters' })
  overrideReason?: string;
}

// DEPRECATED: UpdateAdminStepDto removed - use internalStatus changes instead

export class SetProblemDto {
  @IsBoolean()
  hasProblem: boolean;

  @ValidateIf((o) => o.hasProblem === true)
  @IsEnum(ProblemType, { message: 'Problem type is required when marking a problem' })
  problemType?: ProblemType;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Problem description must be less than 2000 characters' })
  problemDescription?: string;
}

export class SendNotificationDto {
  @IsString()
  @MaxLength(200, { message: 'Title must be less than 200 characters' })
  title: string;

  @IsString()
  @MaxLength(2000, { message: 'Message must be less than 2000 characters' })
  message: string;

  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;
}

/**
 * DTO for admin updates to client profile data (including credentials)
 */
export class AdminUpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'SSN must be less than 20 characters' })
  ssn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Street address must be less than 500 characters' })
  addressStreet?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'City must be less than 100 characters' })
  addressCity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'State must be less than 50 characters' })
  addressState?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'ZIP code must be less than 20 characters' })
  addressZip?: string;

  // TurboTax credentials
  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'TurboTax email must be less than 255 characters' })
  turbotaxEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'TurboTax password must be less than 200 characters' })
  turbotaxPassword?: string;

  // IRS account credentials (encrypted)
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'IRS username must be less than 100 characters' })
  irsUsername?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'IRS password must be less than 200 characters' })
  irsPassword?: string;

  // State account credentials (encrypted)
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'State username must be less than 100 characters' })
  stateUsername?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'State password must be less than 200 characters' })
  statePassword?: string;

  // Bank info (stored in TaxCase)
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Bank name must be less than 100 characters' })
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Routing number must be less than 20 characters' })
  bankRoutingNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30, { message: 'Account number must be less than 30 characters' })
  bankAccountNumber?: string;

  // Employment info (stored in TaxCase)
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'Work state must be less than 50 characters' })
  workState?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'Employer name must be less than 200 characters' })
  employerName?: string;
}
