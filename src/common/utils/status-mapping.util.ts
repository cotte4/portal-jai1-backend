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
 * Interno statuses collapse to their parent labels
 */
export function mapFederalStatusToClientDisplay(status: FederalStatusNew | null | undefined): string {
  if (!status) return 'Sin estado';

  const mapping: Record<FederalStatusNew, string> = {
    [FederalStatusNew.taxes_en_proceso]: 'Taxes en proceso',
    [FederalStatusNew.en_verificacion]: 'En verificacion',
    [FederalStatusNew.verificacion_en_progreso]: 'En verificacion', // interno → parent label
    [FederalStatusNew.problemas]: 'Problemas',
    [FederalStatusNew.verificacion_rechazada]: 'Verificacion rechazada',
    [FederalStatusNew.deposito_directo]: 'Reembolso enviado', // interno → parent label
    [FederalStatusNew.cheque_en_camino]: 'Reembolso enviado', // interno → parent label
    [FederalStatusNew.comision_pendiente]: 'Comision pendiente de pago',
    [FederalStatusNew.taxes_completados]: 'Taxes completados',
  };

  return mapping[status] || status;
}

/**
 * Maps StateStatusNew to client-friendly display label (Spanish)
 * Interno statuses collapse to their parent labels
 */
export function mapStateStatusToClientDisplay(status: StateStatusNew | null | undefined): string {
  if (!status) return 'Sin estado';

  const mapping: Record<StateStatusNew, string> = {
    [StateStatusNew.taxes_en_proceso]: 'Taxes en proceso',
    [StateStatusNew.en_verificacion]: 'En verificacion',
    [StateStatusNew.verificacion_en_progreso]: 'En verificacion', // interno → parent label
    [StateStatusNew.problemas]: 'Problemas',
    [StateStatusNew.verificacion_rechazada]: 'Verificacion rechazada',
    [StateStatusNew.deposito_directo]: 'Reembolso enviado', // interno → parent label
    [StateStatusNew.cheque_en_camino]: 'Reembolso enviado', // interno → parent label
    [StateStatusNew.comision_pendiente]: 'Comision pendiente de pago',
    [StateStatusNew.taxes_completados]: 'Taxes completados',
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
    [FederalStatusNew.taxes_en_proceso]: 'Taxes en Proceso',
    [FederalStatusNew.en_verificacion]: 'En Verificacion',
    [FederalStatusNew.verificacion_en_progreso]: 'Verificacion en Progreso',
    [FederalStatusNew.problemas]: 'Problemas',
    [FederalStatusNew.verificacion_rechazada]: 'Verificacion Rechazada',
    [FederalStatusNew.deposito_directo]: 'Deposito Directo',
    [FederalStatusNew.cheque_en_camino]: 'Cheque en Camino',
    [FederalStatusNew.comision_pendiente]: 'Comision Pendiente',
    [FederalStatusNew.taxes_completados]: 'Taxes Completados',
  };

  return mapping[status] || status;
}

/**
 * Maps StateStatusNew to admin-friendly label (Spanish)
 */
export function getStateStatusNewLabel(status: StateStatusNew | null | undefined): string {
  if (!status) return 'Sin estado';

  const mapping: Record<StateStatusNew, string> = {
    [StateStatusNew.taxes_en_proceso]: 'Taxes en Proceso',
    [StateStatusNew.en_verificacion]: 'En Verificacion',
    [StateStatusNew.verificacion_en_progreso]: 'Verificacion en Progreso',
    [StateStatusNew.problemas]: 'Problemas',
    [StateStatusNew.verificacion_rechazada]: 'Verificacion Rechazada',
    [StateStatusNew.deposito_directo]: 'Deposito Directo',
    [StateStatusNew.cheque_en_camino]: 'Cheque en Camino',
    [StateStatusNew.comision_pendiente]: 'Comision Pendiente',
    [StateStatusNew.taxes_completados]: 'Taxes Completados',
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
  POSSIBLE_VERIFICATION_FEDERAL: 25, // Federal taxes_en_proceso > 25 days
  POSSIBLE_VERIFICATION_STATE: 50,   // State taxes_en_proceso > 50 days
  VERIFICATION_TIMEOUT: 63,          // verificacion_en_progreso > 63 days
  LETTER_SENT_TIMEOUT: 63,           // kept for backward compat
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

    // Possible verification (federal taxes_en_proceso > threshold days)
    if (federalStatus === FederalStatusNew.taxes_en_proceso &&
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

    // Verification timeout (verificacion_en_progreso > threshold days)
    if (federalStatus === FederalStatusNew.verificacion_en_progreso &&
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
  }

  // State alarms (if not disabled)
  if (!disableState && stateStatus && stateStatusChangedAt) {
    const daysSinceChange = daysSince(stateStatusChangedAt);

    // Possible verification (state taxes_en_proceso > threshold days)
    if (stateStatus === StateStatusNew.taxes_en_proceso &&
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

    // Verification timeout (verificacion_en_progreso > threshold days)
    if (stateStatus === StateStatusNew.verificacion_en_progreso &&
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
