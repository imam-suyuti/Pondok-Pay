import { describe, expect, it } from 'vitest';
import { SantriExitService, type SantriExitLedgerPort } from '../src/modules/santri/santri-exit.service.js';

class Ledger implements SantriExitLedgerPort {
  command?: unknown;
  async deactivateSantriExit(input: unknown) {
    this.command = input;
    return { cardsDeactivated: [{ feeCharged: 0, refundAmount: 100 }] };
  }
}

describe('santri exit workflow facade', () => {
  it('delegates the atomic card/santri/wali operation to LedgerService', async () => {
    const ledger = new Ledger();
    const result = await new SantriExitService(ledger).deactivateSantriExit(
      'tenant',
      'santri',
      'staff',
      'GRADUATED',
      12,
    );
    expect(result.cardsDeactivated).toHaveLength(1);
    expect(ledger.command).toEqual({
      tenantId: 'tenant',
      santriId: 'santri',
      staffId: 'staff',
      reason: 'GRADUATED',
      dayOfMonth: 12,
    });
  });
});
