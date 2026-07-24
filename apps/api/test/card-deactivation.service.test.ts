import { describe, expect, it } from 'vitest';
import { CardDeactivationService, type CardDeactivationLedgerPort } from '../src/modules/cards/card-deactivation.service.js';

class Ledger implements CardDeactivationLedgerPort {
  command?: unknown;
  async deactivateCardManual(input: unknown) {
    this.command = input;
    return { feeCharged: 2000, refundAmount: 3000 };
  }
}

describe('manual card deactivation facade', () => {
  it('delegates the full command to LedgerService so ledger_entries stay single-writer', async () => {
    const ledger = new Ledger();
    const result = await new CardDeactivationService(ledger).deactivate('tenant', 'card', 'staff', 12);
    expect(result).toEqual({ feeCharged: 2000, refundAmount: 3000 });
    expect(ledger.command).toEqual({ tenantId: 'tenant', cardId: 'card', staffId: 'staff', dayOfMonth: 12 });
  });
});
