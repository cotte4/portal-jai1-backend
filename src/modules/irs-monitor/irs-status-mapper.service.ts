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
      lower.includes('we received your tax return')
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

    // Identity verification or manual review
    if (
      lower.includes('identity') ||
      lower.includes('verification') ||
      lower.includes('we need more information') ||
      lower.includes('under review')
    ) {
      return FederalStatusNew.en_verificacion;
    }

    // Problems / action required
    if (
      lower.includes('more information') ||
      lower.includes('contact us') ||
      lower.includes('cannot process') ||
      lower.includes('we could not process')
    ) {
      return FederalStatusNew.problemas;
    }

    return null;
  }
}
