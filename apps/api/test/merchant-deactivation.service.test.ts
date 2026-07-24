import { describe, expect, it } from 'vitest';
import {
  MerchantDeactivationService,
  type MerchantDeactivationLedgerPort,
} from '../src/modules/merchants/merchant-deactivation.service.js';

class Ledger implements MerchantDeactivationLedgerPort {
  command?: unknown;
  async deactivateMerchantManual(input: unknown) {
    this.command = input;
    return { feeCharged: 0, settleAmount: 0, unsettledReceivable: 60000 };
  }
}

describe('merchant deactivation facade', () => {
  it('delegates deactivation to LedgerService, including tenant and staff context', async () => {
    const ledger = new Ledger();
    const result = await new MerchantDeactivationService(ledger).deactivate('tenant', 'merchant', 'staff', 20);
    expect(result).toMatchObject({ unsettledReceivable: 60000 });
    expect(ledger.command).toEqual({ tenantId: 'tenant', merchantId: 'merchant', staffId: 'staff', dayOfMonth: 20 });
  });
});
