import { Injectable } from '@nestjs/common';
import { StateStatusNew, PaymentMethod } from '@prisma/client';

@Injectable()
export class ColoradoStatusMapperService {
  /**
   * Maps raw Colorado Revenue Online page text to a JAI1 StateStatusNew value.
   * Returns null if the text doesn't match any known pattern (no update made).
   */
  map(rawText: string, paymentMethod: PaymentMethod): StateStatusNew | null {
    const lower = rawText.toLowerCase();

    // Return Not Received — CO hasn't received the return yet
    if (
      lower.includes('return not received') ||
      lower.includes('not yet processed')
    ) {
      return null; // not found — no status to map
    }

    // Return Received & Being Processed
    if (
      lower.includes('return received') ||
      lower.includes('being processed') ||
      lower.includes('return is being processed')
    ) {
      return StateStatusNew.taxes_en_proceso;
    }

    // Refund Reviewed — still processing but further along
    if (lower.includes('refund reviewed')) {
      return StateStatusNew.taxes_en_proceso;
    }

    // Direct deposit redeemed — money received
    if (
      lower.includes('direct deposit') && lower.includes('redeemed')
    ) {
      return StateStatusNew.taxes_completados;
    }

    // Paper check redeemed — money received
    if (
      lower.includes('paper check') && lower.includes('redeemed')
    ) {
      return StateStatusNew.taxes_completados;
    }

    // Refund Issued — payment sent, determine method
    if (
      lower.includes('refund issued') ||
      lower.includes('refund approved and sent')
    ) {
      return paymentMethod === PaymentMethod.check
        ? StateStatusNew.cheque_en_camino
        : StateStatusNew.deposito_directo;
    }

    // Paper check issued
    if (lower.includes('paper check') && lower.includes('issued')) {
      return StateStatusNew.cheque_en_camino;
    }

    // Direct deposit refund sent
    if (lower.includes('direct deposit') && lower.includes('refund')) {
      return StateStatusNew.deposito_directo;
    }

    return null;
  }
}
