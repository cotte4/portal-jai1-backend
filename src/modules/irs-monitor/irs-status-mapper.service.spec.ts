import { IrsStatusMapperService } from './irs-status-mapper.service';
import { FederalStatusNew, PaymentMethod } from '@prisma/client';

describe('IrsStatusMapperService', () => {
  let mapper: IrsStatusMapperService;

  beforeEach(() => {
    mapper = new IrsStatusMapperService();
  });

  // ─── Helpers ────────────────────────────────────────────────────────────────

  const dd = PaymentMethod.direct_deposit;
  const chk = PaymentMethod.check;

  // ─── Return Received / Still Processing ─────────────────────────────────────

  describe('taxes_en_proceso', () => {
    const cases = [
      'Return Received',
      'We received your tax return and it is being processed',
      'Your tax return is still being processed',
      'A refund date will be provided when available',
    ];

    test.each(cases)('maps "%s" → taxes_en_proceso', (phrase) => {
      expect(mapper.map(phrase, dd)).toBe(FederalStatusNew.taxes_en_proceso);
    });

    it('is case-insensitive', () => {
      expect(mapper.map('RETURN RECEIVED', dd)).toBe(FederalStatusNew.taxes_en_proceso);
      expect(mapper.map('return received', dd)).toBe(FederalStatusNew.taxes_en_proceso);
    });
  });

  // ─── Refund Approved ────────────────────────────────────────────────────────

  describe('refund approved → deposito_directo / cheque_en_camino', () => {
    const approvedPhrases = [
      'Refund Approved',
      'Your refund has been approved',
    ];

    test.each(approvedPhrases)('"%s" with direct_deposit → deposito_directo', (phrase) => {
      expect(mapper.map(phrase, dd)).toBe(FederalStatusNew.deposito_directo);
    });

    test.each(approvedPhrases)('"%s" with check → cheque_en_camino', (phrase) => {
      expect(mapper.map(phrase, chk)).toBe(FederalStatusNew.cheque_en_camino);
    });
  });

  // ─── Refund Sent ─────────────────────────────────────────────────────────────

  describe('refund sent → deposito_directo / cheque_en_camino', () => {
    const sentPhrases = [
      'Refund Sent',
      'Your refund has been sent',
      'Your direct deposit has been sent',
      'Your check was mailed',
    ];

    test.each(sentPhrases)('"%s" with direct_deposit → deposito_directo', (phrase) => {
      expect(mapper.map(phrase, dd)).toBe(FederalStatusNew.deposito_directo);
    });

    test.each(sentPhrases)('"%s" with check → cheque_en_camino', (phrase) => {
      expect(mapper.map(phrase, chk)).toBe(FederalStatusNew.cheque_en_camino);
    });
  });

  // ─── Verification / Action Required ─────────────────────────────────────────

  describe('en_verificacion', () => {
    const cases = [
      'Take Action',
      'Action Required',
      'We need to verify your identity',
      'We need more information',
      'Your return is under review',
      'Your return is being reviewed by the IRS',
      'Identity verification required',
    ];

    test.each(cases)('maps "%s" → en_verificacion', (phrase) => {
      expect(mapper.map(phrase, dd)).toBe(FederalStatusNew.en_verificacion);
    });

    it('does NOT map "Take Action" to problemas', () => {
      expect(mapper.map('Take Action', dd)).not.toBe(FederalStatusNew.problemas);
    });
  });

  // ─── Problems ───────────────────────────────────────────────────────────────

  describe('problemas', () => {
    const cases = [
      'We cannot provide any information about your refund',
      'Your refund has been reduced',
      'Please contact us for more information',
      'We cannot process your return',
      'We could not process your return at this time',
    ];

    test.each(cases)('maps "%s" → problemas', (phrase) => {
      expect(mapper.map(phrase, dd)).toBe(FederalStatusNew.problemas);
    });
  });

  // ─── Null / Unmapped ────────────────────────────────────────────────────────

  describe('null (unmapped)', () => {
    const unknown = [
      '',
      'Error',
      'Could not extract status from page',
      'Playwright not installed',
      'Some completely unknown IRS message',
    ];

    test.each(unknown)('returns null for "%s"', (phrase) => {
      expect(mapper.map(phrase, dd)).toBeNull();
    });
  });

  // ─── Payment method does not affect non-refund statuses ─────────────────────

  it('payment method is irrelevant for taxes_en_proceso', () => {
    expect(mapper.map('Return Received', dd)).toBe(mapper.map('Return Received', chk));
  });

  it('payment method is irrelevant for en_verificacion', () => {
    expect(mapper.map('Take Action', dd)).toBe(mapper.map('Take Action', chk));
  });

  it('payment method is irrelevant for problemas', () => {
    expect(mapper.map('We cannot provide any information about your refund', dd))
      .toBe(mapper.map('We cannot provide any information about your refund', chk));
  });
});
