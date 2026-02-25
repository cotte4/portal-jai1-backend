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

    // Return Received — IRS received the return but hasn't processed it yet
    if (
      lower.includes('return received') ||
      lower.includes('we received your tax return') ||
      lower.includes('still being processed') ||
      lower.includes('refund date will be provided when available')
    ) {
      return FederalStatusNew.taxes_en_proceso;
    }

    // Refund Approved — IRS approved, preparing payment
    if (
      lower.includes('refund approved') ||
      lower.includes('your refund has been approved')
    ) {
      return paymentMethod === PaymentMethod.check
        ? FederalStatusNew.cheque_en_camino
        : FederalStatusNew.deposito_directo;
    }

    // Refund Sent — money is on its way
    if (
      lower.includes('refund sent') ||
      lower.includes('your refund has been sent') ||
      lower.includes('direct deposit') ||
      lower.includes('check was mailed')
    ) {
      return paymentMethod === PaymentMethod.check
        ? FederalStatusNew.cheque_en_camino
        : FederalStatusNew.deposito_directo;
    }

    // Action required / identity verification — distinguish from hard errors
    if (
      lower.includes('take action') ||
      lower.includes('action required') ||
      lower.includes('identity') ||
      lower.includes('we need more information') ||
      lower.includes('under review') ||
      lower.includes('being reviewed') ||
      lower.includes('verification')
    ) {
      return FederalStatusNew.en_verificacion;
    }

    // Problems — IRS cannot process or no info available
    if (
      lower.includes('cannot provide any information') ||
      lower.includes('refund has been reduced') ||
      lower.includes('contact us') ||
      lower.includes('cannot process') ||
      lower.includes('we could not process')
    ) {
      return FederalStatusNew.problemas;
    }

    return null;
  }
}
