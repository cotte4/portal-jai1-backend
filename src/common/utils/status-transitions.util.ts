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
  [FederalStatusNew.in_process, [FederalStatusNew.in_verification, FederalStatusNew.deposit_pending, FederalStatusNew.check_in_transit, FederalStatusNew.issues]],
  [FederalStatusNew.in_verification, [FederalStatusNew.verification_in_progress, FederalStatusNew.deposit_pending, FederalStatusNew.check_in_transit, FederalStatusNew.issues]],
  [FederalStatusNew.verification_in_progress, [FederalStatusNew.verification_letter_sent, FederalStatusNew.deposit_pending, FederalStatusNew.check_in_transit, FederalStatusNew.issues]],
  [FederalStatusNew.verification_letter_sent, [FederalStatusNew.deposit_pending, FederalStatusNew.check_in_transit, FederalStatusNew.issues]],
  [FederalStatusNew.deposit_pending, [FederalStatusNew.taxes_sent, FederalStatusNew.taxes_completed, FederalStatusNew.issues]],
  [FederalStatusNew.check_in_transit, [FederalStatusNew.taxes_sent, FederalStatusNew.issues]],
  [FederalStatusNew.taxes_sent, [FederalStatusNew.taxes_completed, FederalStatusNew.issues]],
  [FederalStatusNew.taxes_completed, [FederalStatusNew.issues]], // terminal but can have issues
  [FederalStatusNew.issues, [FederalStatusNew.in_process, FederalStatusNew.in_verification, FederalStatusNew.deposit_pending, FederalStatusNew.check_in_transit, FederalStatusNew.taxes_sent]],
]);

/**
 * Valid transitions for StateStatusNew (same as FederalStatusNew)
 */
export const STATE_STATUS_TRANSITIONS = new Map<StateStatusNew, StateStatusNew[]>([
  [StateStatusNew.in_process, [StateStatusNew.in_verification, StateStatusNew.deposit_pending, StateStatusNew.check_in_transit, StateStatusNew.issues]],
  [StateStatusNew.in_verification, [StateStatusNew.verification_in_progress, StateStatusNew.deposit_pending, StateStatusNew.check_in_transit, StateStatusNew.issues]],
  [StateStatusNew.verification_in_progress, [StateStatusNew.verification_letter_sent, StateStatusNew.deposit_pending, StateStatusNew.check_in_transit, StateStatusNew.issues]],
  [StateStatusNew.verification_letter_sent, [StateStatusNew.deposit_pending, StateStatusNew.check_in_transit, StateStatusNew.issues]],
  [StateStatusNew.deposit_pending, [StateStatusNew.taxes_sent, StateStatusNew.taxes_completed, StateStatusNew.issues]],
  [StateStatusNew.check_in_transit, [StateStatusNew.taxes_sent, StateStatusNew.issues]],
  [StateStatusNew.taxes_sent, [StateStatusNew.taxes_completed, StateStatusNew.issues]],
  [StateStatusNew.taxes_completed, [StateStatusNew.issues]], // terminal but can have issues
  [StateStatusNew.issues, [StateStatusNew.in_process, StateStatusNew.in_verification, StateStatusNew.deposit_pending, StateStatusNew.check_in_transit, StateStatusNew.taxes_sent]],
]);

// ============= VALIDATION FUNCTIONS =============

export type StatusTransitionType = 'case' | 'federal' | 'state';

/**
 * Checks if a status transition is valid
 * @param type - The type of status (case, federal, or state)
 * @param from - Current status (null/undefined for first status)
 * @param to - Target status
 * @returns true if transition is valid, false otherwise
 */
export function isValidTransition(
  type: StatusTransitionType,
  from: string | null | undefined,
  to: string,
): boolean {
  // null/undefined current status allows any first status
  if (from === null || from === undefined) {
    return true;
  }

  // Same status is always valid (no change)
  if (from === to) {
    return true;
  }

  let transitions: Map<string, string[]>;
  switch (type) {
    case 'case':
      transitions = CASE_STATUS_TRANSITIONS as Map<string, string[]>;
      break;
    case 'federal':
      transitions = FEDERAL_STATUS_TRANSITIONS as Map<string, string[]>;
      break;
    case 'state':
      transitions = STATE_STATUS_TRANSITIONS as Map<string, string[]>;
      break;
    default:
      return false;
  }

  const allowedTransitions = transitions.get(from);
  if (!allowedTransitions) {
    return false;
  }

  return allowedTransitions.includes(to);
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
