import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsDateString,
} from 'class-validator';
import {
  InternalStatus,
  ClientStatus,
  TaxStatus,
  ProblemType,
} from '@prisma/client';

export class UpdateStatusDto {
  @IsOptional()
  @IsEnum(InternalStatus, { message: 'Invalid internal status' })
  internalStatus?: InternalStatus;

  @IsOptional()
  @IsEnum(ClientStatus, { message: 'Invalid client status' })
  clientStatus?: ClientStatus;

  @IsOptional()
  @IsEnum(TaxStatus, { message: 'Invalid federal status' })
  federalStatus?: TaxStatus;

  @IsOptional()
  @IsEnum(TaxStatus, { message: 'Invalid state status' })
  stateStatus?: TaxStatus;

  @IsOptional()
  @IsString()
  comment?: string;

  // Federal tracking fields
  @IsOptional()
  @IsDateString()
  federalEstimatedDate?: string;

  @IsOptional()
  @IsNumber()
  federalActualRefund?: number;

  @IsOptional()
  @IsDateString()
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
