import { describe, expect, it } from 'vitest';
import {
  SettlementPayoutService,
  type SettlementPayoutCommand,
  type SettlementPayoutLedgerPort,
} from '../src/modules/settlements/settlement-payout.service.js';

class Ledger implements SettlementPayoutLedgerPort {
  command?: SettlementPayoutCommand;

  async payoutSettlementInvoice(command: SettlementPayoutCommand) {
    this.command = command;
    return { journalId: 'journal' };
  }
}

describe('merchant settlement payout', () => {
  it('delegates the full payout command to LedgerService as the sole financial writer', async () => {
    const ledger = new Ledger();
    const service = new SettlementPayoutService(ledger);
    const command = {
      tenantId: 'tenant',
      merchantId: 'merchant',
      invoiceId: 'invoice',
      staffId: 'staff',
      amount: 50000,
    };

    await expect(service.payout(command)).resolves.toEqual({ journalId: 'journal' });
    expect(ledger.command).toEqual(command);
  });
});
