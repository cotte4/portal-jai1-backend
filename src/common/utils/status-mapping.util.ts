/**
 * Status Mapping Utility
 * Maps internal status values to client-friendly display labels and handles alarm logic.
 */

import { CaseStatus, FederalStatusNew, StateStatusNew } from '@prisma/client';

// ============= CLIENT DISPLAY MAPPING =============

/**
 * Maps CaseStatus to client-friendly display label (Spanish)
 */
export function mapCaseStatusToClientDisplay(status: CaseStatus | null | undefined): string {
  if (!status) return 'Sin estado';

  const mapping: Record<CaseStatus, string> = {
    [CaseStatus.awaiting_form]: 'Esperando formulario y documentos',
    [CaseStatus.awaiting_docs]: 'Esperando formulario y documentos',
    [CaseStatus.documentos_enviados]: 'Documentos enviados',
    [CaseStatus.preparing]: 'Información recibida',
    [CaseStatus.taxes_filed]: 'Taxes presentados',
    [CaseStatus.case_issues]: 'Problemas - contactar soporte',
  };

  return mapping[status] || status;
}

/**
 * Maps FederalStatusNew to client-friendly display label (Spanish)
 */
export function mapFederalStatusToClientDisplay(status: FederalStatusNew | null | undefined): string {
  if (!status) return 'Sin estado';

  const mapping: Record<FederalStatusNew, string> = {
    [FederalStatusNew.in_process]: 'Taxes en proceso',
    [FederalStatusNew.in_verification]: 'En verificación',
    [FederalStatusNew.verification_in_progress]: 'En verificación',
    [FederalStatusNew.check_in_transit]: 'Cheque en camino',
    [FederalStatusNew.issues]: 'Problemas - contactar soporte',
    [FederalStatusNew.taxes_sent]: 'Reembolso enviado',
    [FederalStatusNew.taxes_completed]: 'Taxes finalizados',
  };

  return mapping[status] || status;
}

/**
 * Maps StateStatusNew to client-friendly display label (Spanish)
 */
export function mapStateStatusToClientDisplay(status: StateStatusNew | null | undefined): string {
  if (!status) return 'Sin estado';

  const mapping: Record<StateStatusNew, string> = {
    [StateStatusNew.in_process]: 'Taxes en proceso',
    [StateStatusNew.in_verification]: 'En verificación',
    [StateStatusNew.verification_in_progress]: 'En verificación',
    [StateStatusNew.check_in_transit]: 'Cheque en camino',
    [StateStatusNew.issues]: 'Problemas - contactar soporte',
    [StateStatusNew.taxes_sent]: 'Reembolso enviado',
    [StateStatusNew.taxes_completed]: 'Taxes finalizados',
  };

  return mapping[status] || status;
}

// ============= ADMIN DISPLAY LABELS =============

/**
 * Maps CaseStatus to admin-friendly label (Spanish)
 */
export function getCaseStatusLabel(status: CaseStatus | null | undefined): string {
  if (!status) return 'Sin estado';

  const mapping: Record<CaseStatus, string> = {
    [CaseStatus.awaiting_form]: 'Esperando Formulario',
    [CaseStatus.awaiting_docs]: 'Esperando Documentos',
    [CaseStatus.documentos_enviados]: 'Documentos Enviados',
    [CaseStatus.preparing]: 'Preparando',
    [CaseStatus.taxes_filed]: 'Taxes Presentados',
    [CaseStatus.case_issues]: 'Problemas',
  };

  return mapping[status] || status;
}

/**
 * Maps FederalStatusNew to admin-friendly label (Spanish)
 */
export function getFederalStatusNewLabel(status: FederalStatusNew | null | undefined): string {
  if (!status) return 'Sin estado';

  const mapping: Record<FederalStatusNew, string> = {
    [FederalStatusNew.in_process]: 'En Proceso',
    [FederalStatusNew.in_verification]: 'En Verificación',
    [FederalStatusNew.verification_in_progress]: 'Verificación en Progreso',
    [FederalStatusNew.check_in_transit]: 'Cheque en Camino',
    [FederalStatusNew.issues]: 'Problemas',
    [FederalStatusNew.taxes_sent]: 'Reembolso Enviado',
    [FederalStatusNew.taxes_completed]: 'Completado',
  };

  return mapping[status] || status;
}

/**
 * Maps StateStatusNew to admin-friendly label (Spanish)
 */
export function getStateStatusNewLabel(status: StateStatusNew | null | undefined): string {
  if (!status) return 'Sin estado';

  const mapping: Record<StateStatusNew, string> = {
    [StateStatusNew.in_process]: 'En Proceso',
    [StateStatusNew.in_verification]: 'En Verificación',
    [StateStatusNew.verification_in_progress]: 'Verificación en Progreso',
    [StateStatusNew.check_in_transit]: 'Cheque en Camino',
    [StateStatusNew.issues]: 'Problemas',
    [StateStatusNew.taxes_sent]: 'Reembolso Enviado',
    [StateStatusNew.taxes_completed]: 'Completado',
  };

  return mapping[status] || status;
}

// ============= ALARM TYPES =============

export type AlarmLevel = 'warning' | 'critical';

export interface StatusAlarm {
  type: 'possible_verification_federal' | 'possible_verification_state' | 'verification_timeout' | 'letter_sent_timeout';
  level: AlarmLevel;
  track: 'federal' | 'state';
  message: string;
  daysSinceStatusChange: number;
  threshold: number;
}

// Note: letter_sent_timeout kept in type for backward compat with existing alarm_history records.
// New alarms will only use verification_timeout (covers all verification sub-states).

// Default alarm thresholds in days
export const DEFAULT_ALARM_THRESHOLDS = {
  POSSIBLE_VERIFICATION_FEDERAL: 25, // Federal in_process > 25 days
  POSSIBLE_VERIFICATION_STATE: 50,   // State in_process > 50 days
  VERIFICATION_TIMEOUT: 63,          // verification_in_progress > 63 days
  LETTER_SENT_TIMEOUT: 63,           // verification_letter_sent > 63 days
};

// Alias for backward compatibility
export const ALARM_THRESHOLDS = DEFAULT_ALARM_THRESHOLDS;

// Custom thresholds interface (matches Prisma AlarmThreshold model)
export interface CustomAlarmThresholds {
  federalInProcessDays?: number | null;
  stateInProcessDays?: number | null;
  verificationTimeoutDays?: number | null;
  letterSentTimeoutDays?: number | null;
  disableFederalAlarms?: boolean;
  disableStateAlarms?: boolean;
}

// ============= ALARM CALCULATION =============

/**
 * Calculates alarms for a tax case based on status and time thresholds.
 * Supports custom thresholds per tax case.
 * Returns an array of active alarms.
 */
export function calculateAlarms(
  federalStatus: FederalStatusNew | null | undefined,
  federalStatusChangedAt: Date | null | undefined,
  stateStatus: StateStatusNew | null | undefined,
  stateStatusChangedAt: Date | null | undefined,
  customThresholds?: CustomAlarmThresholds | null,
): StatusAlarm[] {
  const alarms: StatusAlarm[] = [];
  const now = new Date();

  // Resolve thresholds (custom or default)
  const thresholds = {
    federalInProcess: customThresholds?.federalInProcessDays ?? DEFAULT_ALARM_THRESHOLDS.POSSIBLE_VERIFICATION_FEDERAL,
    stateInProcess: customThresholds?.stateInProcessDays ?? DEFAULT_ALARM_THRESHOLDS.POSSIBLE_VERIFICATION_STATE,
    verificationTimeout: customThresholds?.verificationTimeoutDays ?? DEFAULT_ALARM_THRESHOLDS.VERIFICATION_TIMEOUT,
    letterSentTimeout: customThresholds?.letterSentTimeoutDays ?? DEFAULT_ALARM_THRESHOLDS.LETTER_SENT_TIMEOUT,
  };

  // Check if alarms are disabled
  const disableFederal = customThresholds?.disableFederalAlarms ?? false;
  const disableState = customThresholds?.disableStateAlarms ?? false;

  // Helper to calculate days since a date
  const daysSince = (date: Date | null | undefined): number => {
    if (!date) return 0;
    const diffMs = now.getTime() - new Date(date).getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  };

  // Federal alarms (if not disabled)
  if (!disableFederal && federalStatus && federalStatusChangedAt) {
    const daysSinceChange = daysSince(federalStatusChangedAt);

    // Possible verification (federal in_process > threshold days)
    if (federalStatus === FederalStatusNew.in_process &&
        daysSinceChange > thresholds.federalInProcess) {
      alarms.push({
        type: 'possible_verification_federal',
        level: 'warning',
        track: 'federal',
        message: `Federal: Posible verificación (${daysSinceChange} días en proceso)`,
        daysSinceStatusChange: daysSinceChange,
        threshold: thresholds.federalInProcess,
      });
    }

    // Verification timeout (verification_in_progress > threshold days)
    if (federalStatus === FederalStatusNew.verification_in_progress &&
        daysSinceChange > thresholds.verificationTimeout) {
      alarms.push({
        type: 'verification_timeout',
        level: 'critical',
        track: 'federal',
        message: `Federal: Verificación excedida (${daysSinceChange} días)`,
        daysSinceStatusChange: daysSinceChange,
        threshold: thresholds.verificationTimeout,
      });
    }

    // Note: letter_sent_timeout removed — verification_letter_sent merged into verification_in_progress
    // The verification_timeout alarm above now covers all verification sub-states
  }

  // State alarms (if not disabled)
  if (!disableState && stateStatus && stateStatusChangedAt) {
    const daysSinceChange = daysSince(stateStatusChangedAt);

    // Possible verification (state in_process > threshold days)
    if (stateStatus === StateStatusNew.in_process &&
        daysSinceChange > thresholds.stateInProcess) {
      alarms.push({
        type: 'possible_verification_state',
        level: 'warning',
        track: 'state',
        message: `Estatal: Posible verificación (${daysSinceChange} días en proceso)`,
        daysSinceStatusChange: daysSinceChange,
        threshold: thresholds.stateInProcess,
      });
    }

    // Verification timeout (verification_in_progress > threshold days)
    if (stateStatus === StateStatusNew.verification_in_progress &&
        daysSinceChange > thresholds.verificationTimeout) {
      alarms.push({
        type: 'verification_timeout',
        level: 'critical',
        track: 'state',
        message: `Estatal: Verificación excedida (${daysSinceChange} días)`,
        daysSinceStatusChange: daysSinceChange,
        threshold: thresholds.verificationTimeout,
      });
    }

    // Note: letter_sent_timeout removed — verification_letter_sent merged into verification_in_progress
    // The verification_timeout alarm above now covers all verification sub-states
  }

  return alarms;
}

/**
 * Gets the highest alarm level from a list of alarms.
 * Returns null if no alarms.
 */
export function getHighestAlarmLevel(alarms: StatusAlarm[]): AlarmLevel | null {
  if (alarms.length === 0) return null;
  if (alarms.some(a => a.level === 'critical')) return 'critical';
  return 'warning';
}

