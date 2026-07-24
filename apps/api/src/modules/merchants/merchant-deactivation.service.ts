export interface MerchantDeactivationLedgerPort {
  deactivateMerchantManual(input: {
    tenantId: string;
    merchantId: string;
    staffId: string;
    dayOfMonth: number;
  }): Promise<{ feeCharged: number; settleAmount: number; unsettledReceivable: number }>;
}

/**
 * Merchant module owns the use-case boundary; LedgerService owns all financial
 * posting and the atomic status/receivable update.
 */
export class MerchantDeactivationService {
  constructor(private readonly ledger: MerchantDeactivationLedgerPort) {}

  async deactivate(tenantId: string, merchantId: string, staffId: string, dayOfMonth: number) {
    return this.ledger.deactivateMerchantManual({ tenantId, merchantId, staffId, dayOfMonth });
  }
}
