import { ColoradoStatusMapperService } from './colorado-status-mapper.service';
import { StateStatusNew, PaymentMethod } from '@prisma/client';

describe('ColoradoStatusMapperService', () => {
  let mapper: ColoradoStatusMapperService;

  beforeEach(() => {
    mapper = new ColoradoStatusMapperService();
  });

  // ─── Helpers ────────────────────────────────────────────────────────────────

  const dd = PaymentMethod.bank_deposit;
  const chk = PaymentMethod.check;

  // ─── Return Not Received (null — not found) ────────────────────────────────

  describe('null (return not received)', () => {
    const cases = [
      'Return Not Received',
      'Return Not Received or Not Yet Processed',
      'Your return has not yet processed',
    ];

    test.each(cases)('maps "%s" → null', (phrase) => {
      expect(mapper.map(phrase, dd)).toBeNull();
    });

    it('is case-insensitive for not received', () => {
      expect(mapper.map('RETURN NOT RECEIVED', dd)).toBeNull();
      expect(mapper.map('return not received', dd)).toBeNull();
    });
  });

  // ─── Return Received & Being Processed → taxes_en_proceso ─────────────────

  describe('taxes_en_proceso', () => {
    const cases = [
      'Return Received & Being Processed',
      'Your return is being processed',
      'Return Received',
    ];

    test.each(cases)('maps "%s" → taxes_en_proceso', (phrase) => {
      expect(mapper.map(phrase, dd)).toBe(StateStatusNew.taxes_en_proceso);
    });

    it('is case-insensitive', () => {
      expect(mapper.map('RETURN RECEIVED & BEING PROCESSED', dd)).toBe(StateStatusNew.taxes_en_proceso);
    });
  });

  // ─── Refund Reviewed → taxes_en_proceso ───────────────────────────────────

  describe('refund reviewed → taxes_en_proceso', () => {
    it('maps "Refund Reviewed" → taxes_en_proceso', () => {
      expect(mapper.map('Refund Reviewed', dd)).toBe(StateStatusNew.taxes_en_proceso);
    });
  });

  // ─── Direct Deposit Redeemed → taxes_completados ──────────────────────────

  describe('direct deposit redeemed → taxes_completados', () => {
    const cases = [
      'Your direct deposit refund was redeemed',
      'Direct deposit was redeemed on 01/15/2026',
    ];

    test.each(cases)('maps "%s" → taxes_completados', (phrase) => {
      expect(mapper.map(phrase, dd)).toBe(StateStatusNew.taxes_completados);
    });

    it('maps to taxes_completados regardless of payment method', () => {
      expect(mapper.map('direct deposit was redeemed', chk)).toBe(StateStatusNew.taxes_completados);
    });
  });

  // ─── Paper Check Redeemed → taxes_completados ─────────────────────────────

  describe('paper check redeemed → taxes_completados', () => {
    const cases = [
      'Your paper check was redeemed',
      'Paper check was redeemed on 01/20/2026',
    ];

    test.each(cases)('maps "%s" → taxes_completados', (phrase) => {
      expect(mapper.map(phrase, dd)).toBe(StateStatusNew.taxes_completados);
    });
  });

  // ─── Refund Issued → deposito_directo / cheque_en_camino ──────────────────

  describe('refund issued → payment method determines status', () => {
    const issuedPhrases = [
      'Refund Issued',
      'Refund Approved and Sent',
    ];

    test.each(issuedPhrases)('"%s" with bank_deposit → deposito_directo', (phrase) => {
      expect(mapper.map(phrase, dd)).toBe(StateStatusNew.deposito_directo);
    });

    test.each(issuedPhrases)('"%s" with check → cheque_en_camino', (phrase) => {
      expect(mapper.map(phrase, chk)).toBe(StateStatusNew.cheque_en_camino);
    });
  });

  // ─── Paper Check Issued → cheque_en_camino ────────────────────────────────

  describe('paper check issued → cheque_en_camino', () => {
    it('maps "paper check was issued" → cheque_en_camino', () => {
      expect(mapper.map('Your paper check was issued on 01/18/2026', dd)).toBe(StateStatusNew.cheque_en_camino);
    });
  });

  // ─── Direct Deposit Refund → deposito_directo ─────────────────────────────

  describe('direct deposit refund → deposito_directo', () => {
    it('maps "direct deposit refund" → deposito_directo', () => {
      expect(mapper.map('Your direct deposit refund was sent', dd)).toBe(StateStatusNew.deposito_directo);
    });
  });

  // ─── Unknown / Unmapped ───────────────────────────────────────────────────

  describe('null (unmapped)', () => {
    const unknown = [
      '',
      'Error',
      'Could not extract status from page',
      'Some completely unknown Colorado message',
    ];

    test.each(unknown)('returns null for "%s"', (phrase) => {
      expect(mapper.map(phrase, dd)).toBeNull();
    });
  });

  // ─── Ordering: "Return Not Received" must NOT match "Return Received" ─────

  describe('ordering correctness', () => {
    it('"Return Not Received" returns null, not taxes_en_proceso', () => {
      // Critical: "Return Not Received" contains "Return Received" substring
      // The mapper must check "not received" FIRST and return null
      expect(mapper.map('Return Not Received', dd)).toBeNull();
    });

    it('"Return Received" without "Not" maps to taxes_en_proceso', () => {
      expect(mapper.map('Return Received', dd)).toBe(StateStatusNew.taxes_en_proceso);
    });
  });

  // ─── Payment method is irrelevant for non-refund statuses ─────────────────

  it('payment method is irrelevant for taxes_en_proceso', () => {
    expect(mapper.map('Return Received & Being Processed', dd))
      .toBe(mapper.map('Return Received & Being Processed', chk));
  });

  it('payment method is irrelevant for taxes_completados', () => {
    expect(mapper.map('direct deposit was redeemed', dd))
      .toBe(mapper.map('direct deposit was redeemed', chk));
  });
});
