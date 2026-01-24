import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsBoolean, IsString, IsOptional, Min, Max } from 'class-validator';

export class SetThresholdsDto {
  @ApiPropertyOptional({ description: 'Days before federal in-process status triggers alarm (1-365)', example: 21 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  federalInProcessDays?: number | null;

  @ApiPropertyOptional({ description: 'Days before state in-process status triggers alarm (1-365)', example: 21 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  stateInProcessDays?: number | null;

  @ApiPropertyOptional({ description: 'Days before verification timeout triggers alarm (1-365)', example: 14 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  verificationTimeoutDays?: number | null;

  @ApiPropertyOptional({ description: 'Days before letter sent timeout triggers alarm (1-365)', example: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  letterSentTimeoutDays?: number | null;

  @ApiPropertyOptional({ description: 'Disable federal status alarms', default: false })
  @IsOptional()
  @IsBoolean()
  disableFederalAlarms?: boolean;

  @ApiPropertyOptional({ description: 'Disable state status alarms', default: false })
  @IsOptional()
  @IsBoolean()
  disableStateAlarms?: boolean;

  @ApiPropertyOptional({ description: 'Reason for threshold change (for audit log)' })
  @IsOptional()
  @IsString()
  reason?: string;
}
