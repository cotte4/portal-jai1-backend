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
} from 'class-validator';
import {
  InternalStatus,
  ClientStatus,
  TaxStatus,
  ProblemType,
  PreFilingStatus,
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
  // DEPRECATED: Use preFilingStatus + federalStatus/stateStatus instead
  @IsOptional()
  @IsEnum(InternalStatus, { message: 'Invalid internal status' })
  internalStatus?: InternalStatus;

  @IsOptional()
  @IsEnum(ClientStatus, { message: 'Invalid client status' })
  clientStatus?: ClientStatus;

  // NEW: Phase indicator - when true, use federalStatus/stateStatus
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
  comment?: string;

  // NEW: Separate comments for federal/state tracks
  @IsOptional()
  @IsString()
  federalComment?: string;

  @IsOptional()
  @IsString()
  stateComment?: string;

  // Federal tracking fields
  @IsOptional()
  @IsDateString()
  federalEstimatedDate?: string;

  @IsOptional()
  @IsNumber()
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
  stateActualRefund?: number;

  @IsOptional()
  @IsDateString()
  @IsNotFutureDate({ message: 'State deposit date cannot be in the future' })
  stateDepositDate?: string;
}

// DEPRECATED: UpdateAdminStepDto removed - use internalStatus changes instead

export class SetProblemDto {
  @IsBoolean()
  hasProblem: boolean;

  @IsOptional()
  @IsEnum(ProblemType, { message: 'Invalid problem type' })
  problemType?: ProblemType;

  @IsOptional()
  @IsString()
  problemDescription?: string;
}

export class SendNotificationDto {
  @IsString()
  title: string;

  @IsString()
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
  ssn?: string;

  @IsOptional()
  @IsString()
  addressStreet?: string;

  @IsOptional()
  @IsString()
  addressCity?: string;

  @IsOptional()
  @IsString()
  addressState?: string;

  @IsOptional()
  @IsString()
  addressZip?: string;

  // TurboTax credentials
  @IsOptional()
  @IsString()
  turbotaxEmail?: string;

  @IsOptional()
  @IsString()
  turbotaxPassword?: string;

  // IRS account credentials (encrypted)
  @IsOptional()
  @IsString()
  irsUsername?: string;

  @IsOptional()
  @IsString()
  irsPassword?: string;

  // State account credentials (encrypted)
  @IsOptional()
  @IsString()
  stateUsername?: string;

  @IsOptional()
  @IsString()
  statePassword?: string;

  // Bank info (stored in TaxCase)
  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  bankRoutingNumber?: string;

  @IsOptional()
  @IsString()
  bankAccountNumber?: string;

  // Employment info (stored in TaxCase)
  @IsOptional()
  @IsString()
  workState?: string;

  @IsOptional()
  @IsString()
  employerName?: string;
}
