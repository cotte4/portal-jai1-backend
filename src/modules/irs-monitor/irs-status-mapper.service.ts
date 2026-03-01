import { Injectable } from '@nestjs/common';
import { FederalStatusNew, PaymentMethod } from '@prisma/client';

@Injectable()
export class IrsStatusMapperService {
  /**
   * Maps raw IRS WMR page text to a JAI1 FederalStatusNew value.
   * Returns null if the text doesn't match any known pattern (no update made).
   */
  map(rawText: string, paymentMethod: PaymentMethod): FederalStatusNew | null {
    const lower = rawText.toLowerCase();

    // Order matters: check the most specific descriptive phrases first,
    // then broader terms. The scraper extracts rawStatus from the IRS
    // descriptive paragraph (e.g. "still being processed"), NOT from
    // progress bar labels which are always present on every results page.

    // Return Received — IRS received the return but hasn't processed it yet
    if (
      lower.includes('still being processed') ||
      lower.includes('refund date will be provided when available') ||
      lower.includes('we received your tax return') ||
      lower === 'return received'
    ) {
      return FederalStatusNew.taxes_en_proceso;
    }

    // Refund Sent — money is on its way
    if (
      lower === 'refund sent' ||
      lower.includes('refund was sent') ||
      lower.includes('your refund has been sent') ||
      lower.includes('sent to your bank') ||
      lower.includes('check was mailed') ||
      lower.includes('mailed your refund')
    ) {
      return paymentMethod === PaymentMethod.check
        ? FederalStatusNew.cheque_en_camino
        : FederalStatusNew.deposito_directo;
    }

    // Refund Approved — IRS approved, preparing payment
    if (
      lower === 'refund approved' ||
      lower.includes('refund has been approved') ||
      lower.includes('approved your refund')
    ) {
      return paymentMethod === PaymentMethod.check
        ? FederalStatusNew.cheque_en_camino
        : FederalStatusNew.deposito_directo;
    }

    // Action required / identity verification
    if (
      lower.includes('take action') ||
      lower.includes('action required') ||
      lower.includes('we need more information') ||
      lower.includes('under review') ||
      lower.includes('being reviewed') ||
      lower.includes('identity') ||
      lower.includes('verification')
    ) {
      return FederalStatusNew.en_verificacion;
    }

    // Problems — IRS cannot process or no info available
    if (
      lower.includes('cannot provide any information') ||
      lower.includes('refund has been reduced') ||
      lower.includes('cannot process') ||
      lower.includes('we could not process')
    ) {
      return FederalStatusNew.problemas;
    }

    return null;
  }
}
