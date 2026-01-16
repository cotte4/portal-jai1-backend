import { IsInt, IsBoolean, IsString, IsOptional, Min, Max } from 'class-validator';

export class SetThresholdsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  federalInProcessDays?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  stateInProcessDays?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  verificationTimeoutDays?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  letterSentTimeoutDays?: number | null;

  @IsOptional()
  @IsBoolean()
  disableFederalAlarms?: boolean;

  @IsOptional()
  @IsBoolean()
  disableStateAlarms?: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}
