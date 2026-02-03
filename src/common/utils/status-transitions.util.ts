/**
 * Status Transition Enforcement Utility
 * Defines valid transitions between status values and provides validation functions.
 */

import { CaseStatus, FederalStatusNew, StateStatusNew } from '@prisma/client';

// ============= TRANSITION MAPS =============

/**
 * Valid transitions for CaseStatus
 * Map key: current status
 * Map value: array of allowed next statuses
 */
export const CASE_STATUS_TRANSITIONS = new Map<CaseStatus, CaseStatus[]>([
  [CaseStatus.awaiting_form, [CaseStatus.awaiting_docs, CaseStatus.case_issues]],
  [CaseStatus.awaiting_docs, [CaseStatus.awaiting_form, CaseStatus.documentos_enviados, CaseStatus.preparing, CaseStatus.case_issues]],
  [CaseStatus.documentos_enviados, [CaseStatus.awaiting_docs, CaseStatus.preparing, CaseStatus.case_issues]],
  [CaseStatus.preparing, [CaseStatus.awaiting_docs, CaseStatus.documentos_enviados, CaseStatus.taxes_filed, CaseStatus.case_issues]],
  [CaseStatus.taxes_filed, [CaseStatus.case_issues]],
  [CaseStatus.case_issues, [CaseStatus.awaiting_form, CaseStatus.awaiting_docs, CaseStatus.documentos_enviados, CaseStatus.preparing, CaseStatus.taxes_filed]],
]);

/**
 * Valid transitions for FederalStatusNew
 */
export const FEDERAL_STATUS_TRANSITIONS = new Map<FederalStatusNew, FederalStatusNew[]>([
  [FederalStatusNew.taxes_en_proceso, [FederalStatusNew.en_verificacion, FederalStatusNew.deposito_directo, FederalStatusNew.cheque_en_camino, FederalStatusNew.problemas]],
  [FederalStatusNew.en_verificacion, [FederalStatusNew.verificacion_en_progreso, FederalStatusNew.deposito_directo, FederalStatusNew.cheque_en_camino, FederalStatusNew.problemas, FederalStatusNew.verificacion_rechazada]],
  [FederalStatusNew.verificacion_en_progreso, [FederalStatusNew.deposito_directo, FederalStatusNew.cheque_en_camino, FederalStatusNew.problemas, FederalStatusNew.verificacion_rechazada]],
  [FederalStatusNew.problemas, [FederalStatusNew.taxes_en_proceso, FederalStatusNew.en_verificacion, FederalStatusNew.deposito_directo, FederalStatusNew.cheque_en_camino]],
  [FederalStatusNew.verificacion_rechazada, [FederalStatusNew.en_verificacion, FederalStatusNew.problemas]],
  [FederalStatusNew.deposito_directo, [FederalStatusNew.comision_pendiente, FederalStatusNew.taxes_completados, FederalStatusNew.problemas]],
  [FederalStatusNew.cheque_en_camino, [FederalStatusNew.comision_pendiente, FederalStatusNew.taxes_completados, FederalStatusNew.problemas]],
  [FederalStatusNew.comision_pendiente, [FederalStatusNew.taxes_completados, FederalStatusNew.problemas]],
  [FederalStatusNew.taxes_completados, [FederalStatusNew.problemas]],
]);

/**
 * Valid transitions for StateStatusNew
 */
export const STATE_STATUS_TRANSITIONS = new Map<StateStatusNew, StateStatusNew[]>([
  [StateStatusNew.taxes_en_proceso, [StateStatusNew.en_verificacion, StateStatusNew.deposito_directo, StateStatusNew.cheque_en_camino, StateStatusNew.problemas]],
  [StateStatusNew.en_verificacion, [StateStatusNew.verificacion_en_progreso, StateStatusNew.deposito_directo, StateStatusNew.cheque_en_camino, StateStatusNew.problemas, StateStatusNew.verificacion_rechazada]],
  [StateStatusNew.verificacion_en_progreso, [StateStatusNew.deposito_directo, StateStatusNew.cheque_en_camino, StateStatusNew.problemas, StateStatusNew.verificacion_rechazada]],
  [StateStatusNew.problemas, [StateStatusNew.taxes_en_proceso, StateStatusNew.en_verificacion, StateStatusNew.deposito_directo, StateStatusNew.cheque_en_camino]],
  [StateStatusNew.verificacion_rechazada, [StateStatusNew.en_verificacion, StateStatusNew.problemas]],
  [StateStatusNew.deposito_directo, [StateStatusNew.comision_pendiente, StateStatusNew.taxes_completados, StateStatusNew.problemas]],
  [StateStatusNew.cheque_en_camino, [StateStatusNew.comision_pendiente, StateStatusNew.taxes_completados, StateStatusNew.problemas]],
  [StateStatusNew.comision_pendiente, [StateStatusNew.taxes_completados, StateStatusNew.problemas]],
  [StateStatusNew.taxes_completados, [StateStatusNew.problemas]],
]);

// ============= VALIDATION FUNCTIONS =============

export type StatusTransitionType = 'case' | 'federal' | 'state';

/**
 * Checks if a status transition is valid
 * @param type - The type of status (case, federal, or state)
 * @param from - Current status (null/undefined for first status)
 * @param to - Target status
 * @returns true - all transitions are allowed (admin has full control)
 */
export function isValidTransition(
  type: StatusTransitionType,
  from: string | null | undefined,
  to: string,
): boolean {
  // Allow all transitions - admin has full control
  return true;
}

/**
 * Gets the list of valid next statuses from a current status
 * @param type - The type of status (case, federal, or state)
 * @param current - Current status (null/undefined returns all possible statuses)
 * @returns Array of valid next statuses (always includes current status)
 */
export function getValidNextStatuses(
  type: StatusTransitionType,
  current: string | null | undefined,
): string[] {
  let transitions: Map<string, string[]>;
  let allStatuses: string[];

  switch (type) {
    case 'case':
      transitions = CASE_STATUS_TRANSITIONS as Map<string, string[]>;
      allStatuses = Object.values(CaseStatus);
      break;
    case 'federal':
      transitions = FEDERAL_STATUS_TRANSITIONS as Map<string, string[]>;
      allStatuses = Object.values(FederalStatusNew);
      break;
    case 'state':
      transitions = STATE_STATUS_TRANSITIONS as Map<string, string[]>;
      allStatuses = Object.values(StateStatusNew);
      break;
    default:
      return [];
  }

  // null/undefined current status allows any status
  if (current === null || current === undefined) {
    return allStatuses;
  }

  const allowedTransitions = transitions.get(current);
  if (!allowedTransitions) {
    // If current status is not in map, only allow staying on current
    return [current];
  }

  // Always include current status in valid options
  const result = [current, ...allowedTransitions];
  // Remove duplicates
  return [...new Set(result)];
}

/**
 * Error response structure for invalid transitions
 */
export interface InvalidTransitionError {
  code: 'INVALID_STATUS_TRANSITION';
  statusType: StatusTransitionType;
  currentStatus: string | null;
  attemptedStatus: string;
  allowedTransitions: string[];
  message: string;
}

/**
 * Creates an error object for invalid status transition
 */
export function createInvalidTransitionError(
  type: StatusTransitionType,
  current: string | null | undefined,
  attempted: string,
): InvalidTransitionError {
  const allowedTransitions = getValidNextStatuses(type, current).filter(s => s !== current);
  const typeLabels: Record<StatusTransitionType, string> = {
    case: 'Estado del caso',
    federal: 'Estado federal',
    state: 'Estado estatal',
  };

  return {
    code: 'INVALID_STATUS_TRANSITION',
    statusType: type,
    currentStatus: current || null,
    attemptedStatus: attempted,
    allowedTransitions,
    message: `Transicion de ${typeLabels[type]} no permitida: de "${current || 'sin estado'}" a "${attempted}". Transiciones permitidas: ${allowedTransitions.join(', ') || 'ninguna'}`,
  };
}
